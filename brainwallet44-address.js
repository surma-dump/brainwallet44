const program = require('commander');

console.log(process.argv);

helper.addGlobalOptions(program)
  .parse(process.argv);

console.log(program.account, program.passphrase, program.queryPassphrase);