const program = require('commander');
const helper = require('./helper');

helper.addGlobalOptions(program)
  .arguments('<address> <satoshis> [fee]')
  .action((address, satoshis, fee) => {
     program.address = address;
     program.satoshis = satoshis;
     program.fee = fee || 20000;
  })
  .parse(process.argv);

(async function () {
  await helper.processArguments(program);
  const wallet = await helper.passphraseToWallet(program.passphrase);

  program.satoshis = parseInt(program.satoshis);
  if (Number.isNaN(program.satoshis) || program.satoshis <= 0) 
    throw new Error('Invalid number of satoshis')

  program.fee = parseInt(program.fee);
  if (Number.isNaN(program.fee) || program.fee <= 0) 
    throw new Error('Invalid fee')

  const tx = await wallet.buildTx(
    program.address, program.satoshis, program.fee, 
    {coinType: program.coinType, account: program.account}
  );
  const resp = await program.coinType.publishTx(tx);
  console.log('Done');
})()
  .catch(err => console.log(err.toString(), err.stack));