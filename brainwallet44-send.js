const program = require('commander');
const helper = require('./helper');

helper.addGlobalOptions(program)
  .arguments('<address> <satoshis> [fee]')
  .action((address, satoshis, fee) => {
     program.address = address;
     program.satoshis = satoshis;
     program.fee = fee;
  })
  .parse(process.argv);

(async function () {
  const passphrase = await helper.getPassphrase(program);
})();