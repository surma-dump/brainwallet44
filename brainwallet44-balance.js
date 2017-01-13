const program = require('commander');
const helper = require('./helper');

helper.addGlobalOptions(program)
  .parse(process.argv);

(async function () {
  await helper.processArguments(program);
  const wallet = await helper.passphraseToWallet(program.passphrase);
  const balance = await wallet.balance({coinType: program.coinType, account: program.account});
  console.log(`Balance: ${balance} satoshi`);
})()
  .catch(err => console.log(err.stack));