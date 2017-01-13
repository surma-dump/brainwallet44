const fs = require('fs');
const crypto = require('crypto');
const readline = require('readline');
const btc = require('bitcoinjs-lib');
const bip44wallet = require('./bip44wallet/bip44wallet');
const defaultProviders = require('./bip44wallet/defaultProviders');


module.exports = {
  async getPassphrase(program) {
    if (program.passphrase) 
      return new Buffer(program.passphrase);
    if (program.queryPassphrase) 
      return new Promise(resolve => {
        const rl = readline.createInterface({input: process.stdin});
        rl.question('Passphrase: ', line => {
          rl.close();
          resolve(new Buffer (line));
        });
      });
    
    const filePath = process.env['BRAINWALLET44_WALLET'] || `${process.env['HOME']}/.brainwallet44`;
    return new Promise((resolve, reject) =>
      fs.stat(filePath, err => {
        if (err) throw new Error('No passphrase provided');
        fs.readFile(filePath, (err, data) => err && reject(err) || resolve(data));
      })
    );
  },
  async getCoinType(program) {
    let ctName = program.coinType;
    const ctAsInt = parseInt(ctName);
    if (!Number.isNaN(ctAsInt))
      ctName = defaultProviders.nameByBit44(ctAsInt);
    if (!ctName || !defaultProviders.hasOwnProperty(ctName)) 
      throw new Error(`Invalid coinType "${ctName}"`);
    return defaultProviders[ctName];
  },
  async processArguments(program) {
    program.passphrase = await this.getPassphrase(program);
    program.coinType = await this.getCoinType(program);
  },
  async passphraseToWallet(passphrase) {
    const hash = crypto.createHash('sha256');
    hash.update(passphrase);
    const node = btc.HDNode.fromSeedHex(hash.digest('hex'));
    return new bip44wallet(node);
  },
  addGlobalOptions(program) {
    return program 
      .option('-c --coinType <coin name | ID>', 'BIP44 coin type', 'Bitcoin')
      .option('-a --account <accountID>', 'BIP44 account', parseInt)
      .option('-p --passphrase <passphrase>', 'Master passphrase for wallet')
      .option('-q --query-passphrase', 'Ask for passphrase over stdin')
  }
}