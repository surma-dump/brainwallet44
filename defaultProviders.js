const fetch = require('node-fetch');
const btc = require('bitcoinjs-lib');

function pick(keys, obj) {
  return keys.reduce((a, k) => Object.assign(a, {[k]: obj[k]}), {});
}

module.exports = {
  'Bitcoin': {
    messagePrefix: '\x18Bitcoin Signed Message:\n',
    bip32: {
      public: 0x0488b21e,
      private: 0x0488ade4
    },
    bip44: 0,
    pubKeyHash: 0x00,
    scriptHash: 0x05,
    wif: 0x80,
    dustThreshold: 546, // https://github.com/bitcoin/bitcoin/blob/v0.9.2/src/core.h#L151-L162

    // returns:
    // {
    //   "addresses": [
    //     {"address": "...", "n_tx": 1, "final_balance": 1000000000},
    //     ...
    //   ],
    //   "txs": [
    //     {"hash": "abc...", "out": [{"addr": "...", "n": 0}, ...]}
    //     ...
    //   ]
    // }
    async queryAddresses(addresses) {
      const resp = await fetch(`https://blockchain.info/multiaddr?active=${addresses.join('|')}&cors=true`, {mode: 'cors'})
      const data = await resp.json();
      const newData = {
        addresses: data.addresses.map(addr => pick(['address', 'n_tx', 'final_balance'], addr)),
        txs: data.txs.map(tx => pick(['out', 'hash'], tx))
      };
      newData.txs.forEach(tx => tx.out.map(out => pick(['addr', 'n'], out)));
      return newData;
    },
    async publishTx(tx) {
      const resp = await fetch(`https://blockchain.info/pushtx?tx=${tx}`, {method: 'POST'});
      const body = await resp.text();
      if (!resp.ok) return Promise.reject(body);
      return body;
    }
  },
  'Testnet': {
    messagePrefix: '\x18Bitcoin Signed Message:\n',
    bip32: {
      public: 0x043587cf,
      private: 0x04358394
    },
    bip44: 1,
    pubKeyHash: 0x6f,
    scriptHash: 0xc4,
    wif: 0xef,
    dustThreshold: 546,

    async queryAddresses(addresses) {
      const addrResp = await Promise.all(
        addresses.map(addr => fetch(`https://testnet.blockexplorer.com/api/addr/${addr}`, {mode: 'cors'}))
      );
      const txResp = await fetch(`https://testnet.blockexplorer.com/api/addrs/${addresses.join(',')}/txs`, {mode: 'cors'});
      const addrBodies = await Promise.all(addrResp.map(r => r.json()));
      const txBody = await txResp.json();
      return {
        addresses: addrBodies.map(body => ({
          address: body.addrStr,
          final_balance: body.balanceSat + body.unconfirmedBalanceSat,
          n_tx: body.transactions.length
        })),
        txs: txBody.items.map(tx => ({
          hash: tx.txid,
          out: tx.vout.map(vout => {
            const out = {
              n: vout.n
            };
            const scriptPubKey = btc.script.fromASM(vout.scriptPubKey.asm);
            out.addr = btc.address.fromOutputScript(scriptPubKey, this);
            return out;
          })
        }))
      };
    },
    async publishTx(tx) {
      const resp = await fetch(`https://testnet.blockexplorer.com/api/tx/send?rawtx=${tx}`, {method: 'POST'});
      const body = await resp.text();
      if (!resp.ok) return Promise.reject(body);
      return body;
    }
  },
  litecoin: {
    messagePrefix: '\x19Litecoin Signed Message:\n',
    bip32: {
      public: 0x019da462,
      private: 0x019d9cfe
    },
    bip44: 2,
    pubKeyHash: 0x30,
    scriptHash: 0x05,
    wif: 0xb0,
    dustThreshold: 0 // https://github.com/litecoin-project/litecoin/blob/v0.8.7.2/src/main.cpp#L360-L365
  },
  dogecoin: {
    messagePrefix: '\x19Dogecoin Signed Message:\n',
    bip32: {
      public: 0x02facafd,
      private: 0x02fac398
    },
    bip44: 3,
    pubKeyHash: 0x1e,
    scriptHash: 0x16,
    wif: 0x9e,
    dustThreshold: 0 // https://github.com/dogecoin/dogecoin/blob/v1.7.1/src/core.h#L155-L160
  },
  'Reddcoin': {bip44: 4},
  'Dash': {bip44: 5},
  'Peercoin': {bip44: 6},
  'Namecoin': {bip44: 7},
  'Feathercoin': {bip44: 8},
  'Counterparty': {bip44: 9},
  'Blackcoin': {bip44: 10},
  'NuShares': {bip44: 11},
  'NuBits': {bip44: 12},
  'Mazacoin': {bip44: 13},
  'Viacoin': {bip44: 14},
  'ClearingHouse': {bip44: 15},
  'Rubycoin': {bip44: 16},
  'Groestlcoin': {bip44: 17},
  'Digitalcoin': {bip44: 18},
  'Cannacoin': {bip44: 19},
  'DigiByte': {bip44: 20},
  'Open Assets': {bip44: 21},
  'Monacoin': {bip44: 22},
  'Clams': {bip44: 23},
  'Primecoin': {bip44: 24},
  'Neoscoin': {bip44: 25},
  'Jumbucks': {bip44: 26},
  'ziftrCOIN': {bip44: 27},
  'Vertcoin': {bip44: 28},
  'NXT': {bip44: 29},
  'Burst': {bip44: 30},
  'MonetaryUnit': {bip44: 31},
  'Zoom': {bip44: 32},
  'Vpncoin': {bip44: 33},
  'Canada eCoin': {bip44: 34},
  'ShadowCash': {bip44: 35},
  'ParkByte': {bip44: 36},
  'Pandacoin': {bip44: 37},
  'StartCOIN': {bip44: 38},
  'MOIN': {bip44: 39},
  'Argentum': {bip44: 45},
  'GCRcoin': {bip44: 49},
  'Novacoin': {bip44: 50},
  'Asiacoin': {bip44: 51},
  'Bitcoindark': {bip44: 52},
  'Dopecoin': {bip44: 53},
  'Templecoin': {bip44: 54},
  'AIB': {bip44: 55},
  'EDRCoin': {bip44: 56},
  'Syscoin': {bip44: 57},
  'Solarcoin': {bip44: 58},
  'Smileycoin': {bip44: 59},
  'Ether': {bip44: 60},
  'Ether Classic': {bip44: 61},
  'Pesobit': {bip44: 62},
  'Open Chain': {bip44: 64},
  'OKCash': {bip44: 69},
  'DogecoinDark': {bip44: 77},
  'Electronic Gulden': {bip44: 78},
  'ClubCoin': {bip44: 79},
  'RichCoin': {bip44: 80},
  'Potcoin': {bip44: 81},
  'Quarkcoin': {bip44: 82},
  'Terracoin': {bip44: 83},
  'Gridcoin': {bip44: 84},
  'Auroracoin': {bip44: 85},
  'IXCoin': {bip44: 86},
  'Gulden': {bip44: 87},
  'BitBean': {bip44: 88},
  'Bata': {bip44: 89},
  'Myriadcoin': {bip44: 90},
  'BitSend': {bip44: 91},
  'Unobtanium': {bip44: 92},
  'MasterTrader': {bip44: 93},
  'GoldBlocks': {bip44: 94},
  'Saham': {bip44: 95},
  'Chronos': {bip44: 96},
  'Ubiquoin': {bip44: 97},
  'Evotion': {bip44: 98},
  'SaveTheOcean': {bip44: 99},
  'BigUp': {bip44: 100},
  'GameCredits': {bip44: 101},
  'Dollarcoins': {bip44: 102},
  'Zayedcoin': {bip44: 103},
  'Dubaicoin': {bip44: 104},
  'Stratis': {bip44: 105},
  'Shilling': {bip44: 106},
  'PiggyCoin': {bip44: 118},
  'Monero': {bip44: 128},
  'NavCoin': {bip44: 130},
  'Factom Factoids': {bip44: 131},
  'Factom Entry Credits': {bip44: 132},
  'Zcash': {bip44: 133},
  'Lisk': {bip44: 134},
  'Steem': {bip44: 135},
  'ZCoin': {bip44: 136},
  'Rootstock': {bip44: 137},
  'Giftblock': {bip44: 138},
  'RealPointCoin': {bip44: 139},
  'Rootstock Testnet': {bip44: 37310},
  nameByBit44(id) {
    return Object.entries(this).find(entry => entry[1].bip44 === id)[0];
  }
}
