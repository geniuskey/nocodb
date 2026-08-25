import boxen from 'boxen';

export default function () {
  console.log(`
 ${boxen(`Contribute at https://github.com/geniuskey/rowweave`, {
   title: 'RowWeave is community-built',
   padding: 1,
   margin: 1,
   titleAlignment: 'center',
   borderColor: 'green',
 })}
`);
}
