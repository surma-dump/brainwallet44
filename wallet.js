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
      .derive(index);
  }

  async balance({purpose = 44, coinType = coinIDs['Bitcoin'], account = nonOptional('account'), offset = 0}) {
    const usedAddresses = await this._usedAddresses({purpose, coinType, account, offset});
    return usedAddresses
      .map(addr => addr.final_balance)
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

  async _usedAddresses({purpose = 44, coinType = coinIDs['Bitcoin'], account = nonOptional('account'), offset = 0}) {
    const accumulatedUsedAddresses = [];
    let unusedCount = 0;
    let publicAddressGen = this.addresses({purpose, coinType, account, change: 0, offset});
    let changeAddressGen = this.addresses({purpose, coinType, account, change: 1, offset});

    while (true) {
      const publicAddresses = takeN(publicAddressGen, GAP_DETECT);
      const changeAddresses = takeN(changeAddressGen, GAP_DETECT);
      const allAddresses = [...publicAddresses, ...changeAddresses];
      const transactions = await blockchainQuery(allAddresses.map(a => a.address));

      const usedAddresses = transactions.addresses.filter(t => t.n_tx > 0);
      // If non of the addresses are used, we are done.
      if (usedAddresses.length === 0) return accumulatedUsedAddresses;

      Array.prototype.push.apply(
        accumulatedUsedAddresses,
        usedAddresses
          .map(t => Object.assign(
            t, 
            allAddresses.find(a => t.address === a.address))
          )
          .sort((a, b) => a.path.index - b.path.index)
      );
    }
  }

  async usedAddresses({purpose = 44, coinType = coinIDs['Bitcoin'], account = nonOptional('account'), offset = 0}) {
    const usedAddresses = await this._usedAddresses({purpose, coinType, account, offset});
    return usedAddresses.map(t => t.address);
  }

  async nonEmptyAddresses({purpose = 44, coinType = coinIDs['Bitcoin'], account = nonOptional('account'), offset = 0}) {
    const usedAddresses = await this._usedAddresses({purpose, coinType, account, offset});
    return usedAddresses.filter(t => t.final_balance > 0).map(t => ({address: t.address, balance: t.final_balance}));
  }

  async firstUnusedIndex({purpose = 44, coinType = coinIDs['Bitcoin'], account = nonOptional('account'), offset = 0}) {
    while (true) {
      const addresses = new Array(GAP_DETECT).fill(0)
        .map((_, i) => wallet.keyPair({purpose, coinType, account, change: 0, index: i + offset}).getAddress());
      const transactions = await blockchainQuery(addresses);
      const unusedIndex = addresses.findIndex(addr => transactions.addresses.find(t => t.address === addr).n_tx === 0);
      if (unusedIndex !== -1) return offset+unusedIndex;
      offset += GAP_DETECT;
    }
  }

  async gatherValue(value, {purpose = 44, coinType = coinIDs['Bitcoin'], account = nonOptional('account'), offset = 0}) {
    const usedAddresses = await this._usedAddresses({purpose, coinType, account, offset});
    return usedAddresses
      .sort((a, b) => a.final_balance - b.final_balance)
      .filter(t => {
        if (value <= 0) return false;
        value -= t.final_balance;
        return true;
      });
  }
}

const seed = btc.crypto.sha256(process.argv[2]).toString('hex');

const node = btc.HDNode.fromSeedHex(seed);
const wallet = new BIP44Wallet(node);

// wallet.balance({account: 0}).then(balance => console.log(`Total balance: ${balance} satoshi`));
// wallet.firstUnusedIndex({account: 0}).then(index => {
//   console.log(`First unused transaction index: ${index} (address: ${wallet.keyPair({account: 0, change: 0, index}).getAddress()})`);
// });
wallet.gatherValue(204801, {account: 0}).then(keypairs => console.log(keypairs));
// wallet.nonEmptyAddresses({account: 0}).then(addresses => console.log(`non-empty addresses: ${JSON.stringify(addresses)}`))

// wallet._usedAddresses({account: 0}).then(addr => console.log(addr));
