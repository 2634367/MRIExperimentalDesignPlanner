// Loads the designer's own browser code into a plain context, with nothing
// faked but the UI text, so tests and tools can drive the real compile.js.
const fs = require( "fs" );
const path = require( "path" );
const vm = require( "vm" );

const JS = path.join( __dirname , "..", ".." , "static" , "js" );
const FILES = [ "schema" , "timing" , "hrf" , "compile" , "efficiency" , "validate" , "legacy" , "scanners" ];

function load() {
  const context = vm.createContext( { console , crypto: globalThis.crypto , Math , JSON , I18n: { get: ( key ) => key } } );
  FILES.forEach( ( name ) => vm.runInContext( fs.readFileSync( path.join( JS , name + ".js" ) , "utf8" ) , context , { filename: name + ".js" } ) );
  return ( source ) => vm.runInContext( source , context );
}

module.exports = { load };
