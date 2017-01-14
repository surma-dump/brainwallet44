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

  async balance({purpose = 44, coinType = defaultProviders['Bitcoin'], account = nonOptional('account'), offset = 0}) {
    const transactions = [
      ...await this.transactions({purpose, coinType, account, change: 0, offset}),
      ...await this.transactions({purpose, coinType, account, change: 1, offset}),
    ];
    return transactions
      .map(t => t.out.find(o => !!o.path && !o.spent))
      .map(t => !!t ? t.value : 0)
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

  async transactions({purpose = 44, coinType = defaultProviders['Bitcoin'], account = nonOptional('account'), change = 0, offset = 0}) {
    const allTransactions = [];
    let unusedCount = 0;
    let addressGen = this.addresses({purpose, coinType, account, change, offset});

    while (true) {
      const addresses = takeN(addressGen, GAP_DETECT);
      const rawAddresses = addresses.map(a => a.address);
      const transactions = await coinType.queryAddresses(rawAddresses);

      const unspentTransactions = 
        transactions.txs.filter(tx => 
          tx.out.some(out => rawAddresses.includes(out.addr) && !out.spent));
      
      // If non of the addresses are used, we are done.
      if (transactions.txs.length === 0) return allTransactions;

      Array.prototype.push.apply(
        allTransactions,
        unspentTransactions
          .map(tx => {
            tx.out = tx.out.map(out =>
              Object.assign(
                out,
                addresses.find(a => a.address === out.addr)
              )
            );
            return tx;
          })
      );
    }
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
    const transactions = [
      ...await this.transactions({purpose, coinType, account, change: 0, offset}),
      ...await this.transactions({purpose, coinType, account, change: 1, offset})
    ];
    const usedTransactions = transactions
      .filter (t => t.out.some(out => !!out.path && !out.spent))
      .map(t => Object.assign(t.out.find(out => !!out.path), {txid: t.hash}))
      // get smallest amounts first so we can consolidate
      .sort((a, b) => a.value - b.value)
      .filter(t => {
        if (value <= 0) return false;
        value -= t.value;
        return true;
      });
    return {
      transactions: usedTransactions,
      change: -value,
    };
  }

  async buildTx(target, value, fee, {purpose = 44, coinType = defaultProviders['Bitcoin'], account = nonOptional('account'), offset = 0}) {
    const sources = await this.assembleValue(value + fee, {purpose, coinType, account, offset});
    const changeKey = this.keyPair({
      purpose, coinType, account, 
      change: 1, 
      index: await this.firstUnusedIndex({purpose, coinType, account, change: 1})
    });

    const tx = new btc.TransactionBuilder(coinType);
    sources.transactions.forEach(src => {
      tx.addInput(src.txid, src.n)
    });
    tx.addOutput(target, value);
    if (sources.change > 0) tx.addOutput(changeKey.getAddress(), sources.change);
    sources.transactions.forEach((src, i) =>
      tx.sign(i, this.keyPair(src.path))
    );
    return tx.build().toHex();
  }
}
