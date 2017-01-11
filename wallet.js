const btc = require('bitcoinjs-lib');
const coinIDs = require('./slip44');
const fetch = require('node-fetch');
const GAP_DETECT = 20;

function nonOptional(name) {
  throw new Error(`Parameter "${name}" is not optional`);
  return 0;
}

function takeN(gen, n) {
  return new Array(n).fill(0).map(_ => gen.next().value);
}

function pick(keys, obj) {
  return keys.reduce((a, k) => Object.assign(a, {[k]: obj[k]}), {});
}

function blockchainQuery(addresses = nonOptional('addresses')) {
  return fetch(`https://blockchain.info/multiaddr?active=${addresses.join('|')}&cors=true`, {mode: 'cors'})
    .then(resp => resp.json());
}

class BIP44Wallet {
  constructor(node) {
    this._node = node;
  }

  keyPair({purpose = 44, coinType = coinIDs['Bitcoin'], account = nonOptional('account'), change = nonOptional('change'), index = nonOptional('index')}) {
    return this._node
      .deriveHardened(purpose)
      .deriveHardened(coinType)
      .deriveHardened(account)
      .derive(change)
      .derive(index).keyPair;
  }

  async balance({purpose = 44, coinType = coinIDs['Bitcoin'], account = nonOptional('account'), offset = 0}) {
    const usedAddresses = [
      ...await this._usedAddresses({purpose, coinType, account, change: 0, offset}),
      ...await this._usedAddresses({purpose, coinType, account, change: 1, offset}),
    ];
    return usedAddresses
      .map(addr => addr.balance)
      .reduce((sum, addr) => sum + addr, 0);
  }

  *addresses({purpose = 44, coinType = coinIDs['Bitcoin'], account = nonOptional('account'), change = 0, offset = 0}) {
    let index = offset;
    while(true) {
      yield {
        address: this.keyPair({purpose, coinType, account, change, index}).getAddress(),
        path: {purpose, coinType, account, change, index}
      };
      index++;
    }
  }

  async _usedAddresses({purpose = 44, coinType = coinIDs['Bitcoin'], account = nonOptional('account'), change = 0, offset = 0}) {
    const accumulatedUsedAddresses = [];
    let unusedCount = 0;
    let addressGen = this.addresses({purpose, coinType, account, change, offset});

    while (true) {
      const addresses = takeN(addressGen, GAP_DETECT);
      const transactions = await blockchainQuery(addresses.map(a => a.address));

      const usedAddresses = transactions.addresses.filter(t => t.n_tx > 0);
      // If non of the addresses are used, we are done.
      if (usedAddresses.length === 0) return accumulatedUsedAddresses;


      Array.prototype.push.apply(
        accumulatedUsedAddresses,
        usedAddresses
          .map(ua => Object.assign(
            // address and path
            addresses.find(a => a.address === ua.address),
            {balance: ua.final_balance},
            {
              transaction: pick(['hash', 'inputs', 'out'], transactions.txs.find(t => t.out.some(o => o.addr === ua.address)))
            }
          ))
          .sort((a, b) => a.path.index - b.path.index)
      );
    }
  }

  async usedAddresses({purpose = 44, coinType = coinIDs['Bitcoin'], account = nonOptional('account'), offset = 0}) {
    const usedAddresses1 = await this._usedAddresses({purpose, coinType, account, change: 0, offset});
    const usedAddresses2 = await this._usedAddresses({purpose, coinType, account, change: 1, offset});
    return [...usedAddresses1, ...usedAddresses2]
      .sort((a, b) => a.path.index - b.path.index)
  }

  async nonEmptyAddresses({purpose = 44, coinType = coinIDs['Bitcoin'], account = nonOptional('account'), offset = 0}) {
    const usedAddresses = await this._usedAddresses({purpose, coinType, account, offset});
    return usedAddresses.filter(t => t.balance > 0)
  }

  async firstUnusedIndex({purpose = 44, coinType = coinIDs['Bitcoin'], account = nonOptional('account'), change = 0, offset = 0}) {
    while (true) {
      const addresses = new Array(GAP_DETECT).fill(0)
        .map((_, i) => wallet.keyPair({purpose, coinType, account, change, index: i + offset}).getAddress());
      const transactions = await blockchainQuery(addresses);
      const unusedIndex = addresses.findIndex(addr => transactions.addresses.find(t => t.address === addr).n_tx === 0);
      if (unusedIndex !== -1) return offset + unusedIndex;
      offset += GAP_DETECT;
    }
  }

  async assembleValue(value, {purpose = 44, coinType = coinIDs['Bitcoin'], account = nonOptional('account'), offset = 0}) {
    const usedAddresses = await this._usedAddresses({purpose, coinType, account, offset});
    return usedAddresses
      // get smallest amounts first so we can consolidate
      .sort((a, b) => a.balance - b.balance)
      .filter(t => {
        if (value <= 0) return false;
        value -= t.balance;
        return true;
      })
      .map((a, i, arr) => {
        if (i === arr.length - 1) return Object.assign(a, {withdraw: a.balance + value});
        return Object.assign(a, {withdraw: a.balance});
      });
  }

  async sendValue(target, value, fee, {purpose = 44, coinType = coinIDs['Bitcoin'], account = nonOptional('account'), offset = 0}) {
    const sources = await this.assembleValue(value + fee, {purpose, coinType, account, offset});
    const change = sources[sources.length - 1].balance - sources[sources.length - 1].withdraw;
    const changeKey = this.keyPair({
      purpose, coinType, account, 
      change: 1, 
      index: await this.firstUnusedIndex({purpose, coinType, account, change: 1})
    });

    const tx = new btc.TransactionBuilder();
    sources.forEach((src, i) => {
      tx.addInput(src.transaction.hash, src.transaction.out.find(o => o.addr === src.address).n)
    });
    tx.addOutput(target, value);
    if (change > 0) tx.addOutput(changeKey.getAddress(), change);
    sources.forEach((src, i) =>
      tx.sign(i, this.keyPair(src.path))
    );
    return tx.build();
  }
}

const seed = btc.crypto.sha256(process.argv[2]).toString('hex');

const node = btc.HDNode.fromSeedHex(seed);
const wallet = new BIP44Wallet(node);

wallet.balance({account: 0}).then(balance => console.log(`Total balance: ${balance} satoshi`));
// wallet.firstUnusedIndex({account: 0}).then(index => {
//   console.log(`First unused transaction index: ${index} (address: ${wallet.keyPair({account: 0, change: 0, index}).getAddress()})`);
// });
// wallet.assembleValue(204801, {account: 0}).then(keypairs => console.log(keypairs));

// wallet.nonEmptyAddresses({account: 0}).then(addresses => console.log(`non-empty addresses: ${JSON.stringify(addresses)}`))

// wallet._usedAddresses({account: 0}).then(addr => console.log(addr));
// wallet.sendValue('3FeF2YermL5BR8nEqHHNHghvYzxDCvY2qr', 204800, 20000, {account: 0}).then(x => console.log(x.toHex()))
  // .catch(err => console.log(err.toString(), err.stack));