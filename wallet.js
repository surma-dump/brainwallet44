const btc = require('bitcoinjs-lib');
const coinIDs = require('./slip44');
const fetch = require('node-fetch');
const GAP_DETECT = 20;
const gapArray = new Array(GAP_DETECT).fill(0).map((_, i) => i);

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

  async balance({purpose = 44, coinType = coinIDs['Bitcoin'], account = nonOptional('account')}) {
    const addresses = [
      ...gapArray.map(i => wallet.keyPair({account: 0, change: 0, index: i}).getAddress()),
      ...gapArray.map(i => wallet.keyPair({account: 0, change: 1, index: i}).getAddress())
    ];
    const transactions = await blockchainQuery(addresses);
    return transactions.addresses
      .map(addr => addr.final_balance)
      .reduce((sum, addr) => sum + addr, 0);
  }

  *addresses({purpose = 44, coinType = coinIDs['Bitcoin'], account = nonOptional('account'), change = 0, offset = 0}) {
    let index = offset;
    while(true) {
      yield this.keyPair({purpose, coinType, account, change, index: index++}).getAddress()
    }
  }

  async _usedAddresses({purpose = 44, coinType = coinIDs['Bitcoin'], account = nonOptional('account')}) {
    const accumulatedUsedAddresses = [];
    let unusedCount = 0;
    let publicAddressGen = this.addresses({purpose, coinType, account, change: 0});
    let changeAddressGen = this.addresses({purpose, coinType, account, change: 1});

    while (true) {
      const publicAddresses = takeN(publicAddressGen, GAP_DETECT);
      const changeAddresses = takeN(changeAddressGen, GAP_DETECT);
      const transactions = await blockchainQuery([...publicAddresses, ...changeAddresses]);

      const usedAddresses = transactions.addresses.filter(t => t.n_tx > 0);
      // If non of the addresses are used, we are done.
      if (usedAddresses.length === 0) return accumulatedUsedAddresses;

      Array.prototype.push.apply(
        accumulatedUsedAddresses,
        usedAddresses
      );
    }
  }

  async usedAddresses({purpose = 44, coinType = coinIDs['Bitcoin'], account = nonOptional('account')}) {
    const usedAddresses = await this._usedAddresses({purpose, coinType, account});
    return usedAddresses.map(t => t.address);
  }

  async nonEmptyAddresses({purpose = 44, coinType = coinIDs['Bitcoin'], account = nonOptional('account')}) {
    const usedAddresses = await this._usedAddresses({purpose, coinType, account});
    return usedAddresses.filter(t => t.final_balance > 0).map(t => ({address: t.address, balance: t.final_balance}));
  }

  async firstUnusedAddress({purpose = 44, coinType = coinIDs['Bitcoin'], account = nonOptional('account'), offset = 0}) {
    while (true) {
      const addresses = gapArray
        .map(i => wallet.keyPair({purpose, coinType, account, change: 0, index: i + offset}).getAddress())
      const transactions = await blockchainQuery(addresses);
      const unusedAddress = transactions.addresses.find(addr => addr.n_tx === 0);
      if (unusedAddress) return unusedAddress.address;
      offset += gapArray.length;
    }
  }
}

const seed = btc.crypto.sha256(process.argv[2]).toString('hex');

const node = btc.HDNode.fromSeedHex(seed);
const wallet = new BIP44Wallet(node);

wallet.balance({account: 0}).then(balance => console.log(`Total balance: ${balance} satoshi`));
wallet.firstUnusedAddress({account: 0}).then(address => console.log(`First unused address: ${address}`));
wallet.usedAddresses({account: 0}).then(addresses => console.log(`Used addresses: ${addresses.join(', ')}`))
wallet.nonEmptyAddresses({account: 0}).then(addresses => console.log(`non-empty addresses: ${JSON.stringify(addresses)}`))
