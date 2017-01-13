#!/usr/bin/env node --harmony-async-await
const program = require('commander');

program
  .command('balance', 'Show the wallet’s total balance', {isDefault: true})
  .command('address', 'Show the wallet’s next free address')
  .command('send <address> <satoshis> [fee]', 'Send money to an address')
  .parse(process.argv);