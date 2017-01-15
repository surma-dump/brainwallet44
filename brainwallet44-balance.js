const program = require('commander');
const helper = require('./helper');

helper.addGlobalOptions(program)
  .option('--verbose', 'Verbose output')
  .parse(process.argv);

function flatten(arr) {
  return Array.prototype.concat.apply([], arr);
}

function groupBy(arr, f) {
  const r = {};
  arr.map(e => [f(e), e]).forEach(([k, e]) => {
    r[k] = r[k] || [];
    r[k].push(e);
  }); 
  return r;
}

(async function () {
  await helper.processArguments(program);
  const wallet = await helper.passphraseToWallet(program.passphrase);
  if (program.verbose) {
    const txs = [
      ...await wallet.transactions({coinType: program.coinType, account: program.account, change: 0}),
      ...await wallet.transactions({coinType: program.coinType, account: program.account, change: 1})
    ];
    const outsByAddr = groupBy(flatten(txs.map(tx => tx.out)).filter(o => !!o.address && !o.spent), o => o.address);
    Object.entries(outsByAddr).forEach(([addr, outs]) => {
      console.log(`${addr}: ${outs.reduce((sum, o) => sum + o.value, 0)}`);
    })
  } else {
    const balance = await wallet.balance({coinType: program.coinType, account: program.account});
    console.log(`Balance: ${balance} satoshi`);
  }
})()
  .catch(err => console.log(err.stack));