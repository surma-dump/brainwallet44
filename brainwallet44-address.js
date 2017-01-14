const program = require('commander');
const helper = require('./helper');

helper.addGlobalOptions(program)
  .parse(process.argv);

(async function () {
  await helper.processArguments(program);
  const wallet = await helper.passphraseToWallet(program.passphrase);
  const index = await wallet.firstUnusedIndex({coinType: program.coinType, account: program.account});
  console.log(wallet.keyPair({coinType: program.coinType, account: program.account, change: 0, index}).getAddress());
})()
  .catch(err => console.log(err.stack));