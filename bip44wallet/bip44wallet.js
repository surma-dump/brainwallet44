const btc = require('bitcoinjs-lib');
const defaultProviders = require('./defaultProviders');
const GAP_DETECT = 20;

function nonOptional(name) {
  throw new Error(`Parameter "${name}" is not optional`);
  return 0;
}

function takeN(gen, n) {
  return new Array(n).fill(0).map(_ => gen.next().value);
}

module.exports = class BIP44Wallet {
  static get defaultProviders() {return defaultProviders;}

  constructor(node, providers = {}) {
    this._node = node;
    this._providers = Object.assign({}, defaultProviders, providers);
  }

  keyPair({purpose = 44, coinType = defaultProviders['Bitcoin'], account = nonOptional('account'), change = nonOptional('change'), index = nonOptional('index')}) {
    return Object.assign(
      this._node
        .deriveHardened(purpose)
        .deriveHardened(coinType.bip44)
        .deriveHardened(account)
        .derive(change)
        .derive(index).keyPair,
        {network: coinType}
    );
  }

  provider(coinType) {
    if (coinType in this._provider) return this._provider[coinType];
    throw new Error(`No provider for ${this._providers.nameByBit44(coinType.bit44)}`);
  }

  async balance({purpose = 44, coinType = defaultProviders['Bitcoin'], account = nonOptional('account'), offset = 0}) {
    const usedAddresses = [
      ...await this._usedAddresses({purpose, coinType, account, change: 0, offset}),
      ...await this._usedAddresses({purpose, coinType, account, change: 1, offset}),
    ];
    return usedAddresses
      .map(addr => addr.balance)
      .reduce((sum, addr) => sum + addr, 0);
  }

  *addresses({purpose = 44, coinType = defaultProviders['Bitcoin'], account = nonOptional('account'), change = 0, offset = 0}) {
    let index = offset;
    while(true) {
      yield {
        address: this.keyPair({purpose, coinType, account, change, index}).getAddress(),
        path: {purpose, coinType, account, change, index}
      };
      index++;
    }
  }

  async _usedAddresses({purpose = 44, coinType = defaultProviders['Bitcoin'], account = nonOptional('account'), change = 0, offset = 0}) {
    const accumulatedUsedAddresses = [];
    let unusedCount = 0;
    let addressGen = this.addresses({purpose, coinType, account, change, offset});

    while (true) {
      const addresses = takeN(addressGen, GAP_DETECT);
      const transactions = await coinType.queryAddresses(addresses.map(a => a.address));

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
            {transaction: transactions.txs.find(t => t.out.some(o => o.addr === ua.address))}
          ))
          .sort((a, b) => a.path.index - b.path.index)
      );
    }
  }

  async usedAddresses({purpose = 44, coinType = defaultProviders['Bitcoin'], account = nonOptional('account'), offset = 0}) {
    return [
      ...await this._usedAddresses({purpose, coinType, account, change: 0, offset}), 
      ...await this._usedAddresses({purpose, coinType, account, change: 1, offset})
    ]
      .sort((a, b) => a.path.index - b.path.index)
  }

  async nonEmptyAddresses({purpose = 44, coinType = defaultProviders['Bitcoin'], account = nonOptional('account'), offset = 0}) {
    const usedAddresses = await this._usedAddresses({purpose, coinType, account, offset});
    return usedAddresses.filter(t => t.balance > 0)
  }

  async firstUnusedIndex({purpose = 44, coinType = defaultProviders['Bitcoin'], account = nonOptional('account'), change = 0, offset = 0}) {
    while (true) {
      const addresses = new Array(GAP_DETECT).fill(0)
        .map((_, i) => this.keyPair({purpose, coinType, account, change, index: i + offset}).getAddress());
      const transactions = await coinType.queryAddresses(addresses);
      const unusedIndex = addresses.findIndex(addr => transactions.addresses.find(t => t.address === addr).n_tx === 0);
      if (unusedIndex !== -1) return offset + unusedIndex;
      offset += GAP_DETECT;
    }
  }

  async assembleValue(value, {purpose = 44, coinType = defaultProviders['Bitcoin'], account = nonOptional('account'), offset = 0}) {
    const usedAddresses = [
      ...await this._usedAddresses({purpose, coinType, account, change: 0, offset}),
      ...await this._usedAddresses({purpose, coinType, account, change: 1, offset})
    ];
    return usedAddresses
      // get smallest amounts first so we can consolidate
      .sort((a, b) => a.balance - b.balance)
      .filter(t => {
        if (value <= 0) return false;
        if (t.balance <= 0) return false;
        value -= t.balance;
        return true;
      })
      .map((a, i, arr) => {
        if (i === arr.length - 1) return Object.assign(a, {withdraw: a.balance + value});
        return Object.assign(a, {withdraw: a.balance});
      });
  }

  async buildTx(target, value, fee, {purpose = 44, coinType = defaultProviders['Bitcoin'], account = nonOptional('account'), offset = 0}) {
    const sources = await this.assembleValue(value + fee, {purpose, coinType, account, offset});
    const change = sources[sources.length - 1].balance - sources[sources.length - 1].withdraw;
    const changeKey = this.keyPair({
      purpose, coinType, account, 
      change: 1, 
      index: await this.firstUnusedIndex({purpose, coinType, account, change: 1})
    });

    const tx = new btc.TransactionBuilder(coinType);
    sources.forEach((src, i) => {
      tx.addInput(src.transaction.hash, src.transaction.out.find(o => o.addr === src.address).n)
    });
    tx.addOutput(target, value);
    if (change > 0) tx.addOutput(changeKey.getAddress(), change);
    sources.forEach((src, i) =>
      tx.sign(i, this.keyPair(src.path))
    );
    return tx.build().toHex();
  }
}
