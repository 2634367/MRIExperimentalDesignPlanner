// What compile.js promises, checked against the real code and the example
// study. Run by test_compile.py; prints what failed and exits 1.
const fs = require( "fs" );
const path = require( "path" );
const { load } = require( "./browser_code.js" );

const run = load();
const study = fs.readFileSync( path.join( __dirname , ".." , ".." , "misc" , "inner-speech-v4.json" ) , "utf8" );
run( "var doc = Schema.normalise(" + study + "); var X = { id: 'x' };" );
const failures = [];
const check = ( name , ok ) => { if ( !ok ) failures.push( name ); };
const shown = ( plan ) => plan.segments.filter( ( s ) => s.kind !== "instructions" );

// Blocks.
const fullRun = run( "var fullRun = doc.runs.find( ( r ) => r.blocks.length > 1 ); Compile.runPlans( doc , X , fullRun.id , { seed: 7 } )[ 0 ]" );
const pilot = run( "Compile.runPlans( doc , X , fullRun.id , { seed: 7 , blocks: 1 } )[ 0 ]" );
check( "every phase knows its block" , shown( fullRun ).filter( ( s ) => s.kind === "phase" ).every( ( s ) => Number.isInteger( s.block ) ) );
check( "a whole run is not marked pilot" , fullRun.pilot_blocks === undefined );
check( "a pilot says so" , pilot.pilot_blocks === 1 );
check( "a pilot is shorter" , pilot.total_seconds < fullRun.total_seconds );
check( "a pilot plays only its blocks" , shown( pilot ).filter( ( s ) => s.kind === "phase" ).every( ( s ) => s.block === 0 ) );
const firstTrials = ( plan , n ) => shown( plan ).filter( ( s ) => s.kind === "phase" ).slice( 0 , n ).map( ( s ) => [ s.item , s.duration ] );
const trialsInPilot = shown( pilot ).filter( ( s ) => s.kind === "phase" ).length;
check( "a pilot starts with the whole run's own trials" , JSON.stringify( firstTrials( pilot , trialsInPilot ) ) === JSON.stringify( firstTrials( fullRun , trialsInPilot ) ) );

// Visits.
const session = "doc.sessions.find( ( s ) => s.steps.some( ( st ) => st.kind === 'run' ) )";
const byPosition = run( "Compile.sessionPlans( doc , X , " + session + ".id , { seed: 7 } )" );
const third = run( "Compile.sessionPlans( doc , X , " + session + ".id , { seed: 7 , visit: 3 } )" );
check( "without a visit, the session's place in the design" , byPosition[ 0 ].run.label.startsWith( "ses-01_" ) && byPosition[ 0 ].visit === 1 );
check( "a visit is the ses- label" , third.every( ( p ) => p.run.label.startsWith( "ses-03_" ) && p.visit === 3 ) );

// Seen items.
const itemsOf = ( plans ) => plans.flatMap( ( p ) => p.segments.map( ( s ) => s.item ).filter( Boolean ) );
const first = itemsOf( run( "Compile.runPlans( doc , X , fullRun.id , { seed: 7 } )" ) );
run( "var seenOnce = new Set( " + JSON.stringify( first ) + " );" );
const next = itemsOf( run( "Compile.runPlans( doc , X , fullRun.id , { seed: 8 , seen: seenOnce } )" ) );
const overlap = next.filter( ( id ) => first.includes( id ) ).length;
const without = itemsOf( run( "Compile.runPlans( doc , X , fullRun.id , { seed: 8 } )" ) ).filter( ( id ) => first.includes( id ) ).length;
check( "seen items are avoided while unseen ones remain" , overlap < without );
const everything = run( "var all = new Set( doc.lists.flatMap( ( l ) => l.items.map( ( i ) => i.id ) ) ); Compile.runPlans( doc , X , fullRun.id , { seed: 8 , seen: all } )[ 0 ]" );
check( "a list with nothing unseen repeats and warns" , everything.warnings.some( ( w ) => w.kind === "seen_before" ) && shown( everything ).some( ( s ) => s.item ) );

// Steps switched off.
const offSession = "var off = JSON.parse( JSON.stringify( doc ) ); var ses = off.sessions.find( ( s ) => s.steps.filter( ( st ) => st.kind === 'run' ).length > 1 ); ";
const runsWith = run( offSession + "Compile.sessionPlans( off , X , ses.id , { seed: 7 } ).length" );
const lengthWith = run( "Timing.session( off , ses ).seconds.mean" );
run( "ses.steps.find( ( st ) => st.kind === 'run' ).enabled = false;" );
check( "a step switched off does not play" , run( "Compile.sessionPlans( off , X , ses.id , { seed: 7 } ).length" ) === runsWith - 1 );
check( "a step switched off takes no time" , run( "Timing.session( off , ses ).seconds.mean" ) < lengthWith );
check( "a step survives being switched off" , run( "Schema.normalise( off ).sessions.find( ( s ) => s.id === ses.id ).steps.some( ( st ) => st.enabled === false )" ) );
check( "a step is on unless switched off" , run( "Schema.normalise( { name: 'x' , sessions: [ { steps: [ { kind: 'break' } ] } ] } ).sessions[ 0 ].steps[ 0 ].enabled" ) === true );

// Answer balance.
run( `
  var two = Schema.blank( 'two' );
  var list = Schema.list( 'L' );
  list.columns = [ Schema.column( 'Answer' , 'text' , [] ) ];
  for ( var i = 0; i < 400; i += 1 ) list.items.push( Object.assign( Schema.item( { answer: i % 2 ? 'no' : 'yes' } ) , {} ) );
  two.lists.push( list );
  var tt = Schema.trialType( 'T' );
  tt.list = list.id; tt.balance_by = 'answer'; tt.phases = [ Schema.phase( 'p' , Schema.duration( 'fixed' , 1 ) , [] ) ];
  two.trial_types.push( tt );
  var picks = ( pct , seed ) => {
    tt.balance_pct = pct;
    var picker = Compile.picker( two , Compile.rng( seed ) );
    var out = [];
    for ( var n = 0; n < 100; n += 1 ) out.push( picker.pick( tt ).item.values.answer );
    return out;
  };
` );
const yes = ( pct , seed ) => run( "picks( " + pct + " , " + seed + " ).filter( ( a ) => a === 'yes' ).length" );
check( "50% stays even" , yes( 50 , 1 ) === 50 );
check( "70% gives the first value 70%" , Math.abs( yes( 70 , 1 ) - 70 ) <= 1 );
check( "100% gives only the first value" , yes( 100 , 1 ) === 100 );
check( "0% gives none of the first value" , yes( 0 , 1 ) === 0 );
check( "an uneven share is not a fixed pattern" , run( "picks( 70 , 1 ).join() !== picks( 70 , 2 ).join()" ) );
check( "two values are found, first as listed" , run( "Compile.balancePair( tt , list.items ).join()" ) === "yes,no" );

// Measures.
run( `
  var m = Schema.blank( 'm' );
  var mt = Schema.trialType( 'T' );
  mt.phases = [ Object.assign( Schema.phase( 'p' , Schema.duration( 'fixed' , 2 ) , [] ) , { modelled: true } ) ];
  m.trial_types.push( mt );
  var mr = Schema.run( 'R' , mt.id );
  mr.blocks[ 0 ].mix[ 0 ].count = 40;
  m.runs.push( mr );
` );
const packed = run( "mt.phases.push( Schema.phase( 'gap' , Schema.duration( 'fixed' , 1 ) , [] ) ); Efficiency.run( m , mr , 1 )" );
const apart = run( "mt.phases[ 1 ].duration.value = 30; Efficiency.run( m , mr , 1 )" );
check( "trials close together stack" , packed.stacking > 1.5 );
check( "trials far apart do not stack" , Math.abs( apart.stacking - 1 ) < 0.05 );
check( "a packed run holds its signal up" , packed.sustain > 0.7 );
check( "a sparse run falls back between trials" , apart.sustain < packed.sustain );
check( "a geometric wait has a last rung" , Math.abs( run( "Timing.anticipatable( Object.assign( Schema.duration( 'geometric' , 2 , 4 ) , { p: 0.5 } ) , 1 )" ) - 1 / 7 ) < 1e-9 );
check( "only a geometric wait has one" , run( "Timing.anticipatable( Schema.duration( 'fixed' , 2 ) , 1 )" ) === null );

// Limits.
const warned = ( key ) => run( "Validate.check( lim ).filter( ( p ) => p.text === 'problems." + key + "' ).length" );
run( "var lim = Schema.normalise( JSON.parse( JSON.stringify( doc ) ) );" );
check( "no limit, no warning" , warned( "limit_run" ) === 0 && warned( "limit_session" ) === 0 && warned( "limit_runs" ) === 0 );
run( "lim.limits = { max_run_minutes: 0.5 , max_session_minutes: 1 , max_runs_per_session: 1 };" );
check( "a run over the limit is flagged" , warned( "limit_run" ) > 0 );
check( "a session over the limit is flagged" , warned( "limit_session" ) > 0 );
check( "too many runs are flagged" , warned( "limit_runs" ) > 0 );

// Scanner cards: sizes and timing.
run( `
  var row = ( parameter , value ) => ( { parameter , value , indent: 0 } );
  var epi = { id: 'c' , label: 'EPI' , role: 'functional' , pages: [ { name: 'P' , rows: [
    row( 'Reconstruction matrix' , '96' ) , row( 'slices' , '58' ) , row( 'Act. TR/TE (ms)' , '2000 / 36' ) ,
    row( 'Total scan duration' , '23:59.9' ) , row( 'dyn scans' , '712' ) , row( 'dummy scans' , '6' ) ] } ] };
  var sized = Schema.normalise( JSON.parse( JSON.stringify( doc ) ) );
  sized.runs.forEach( ( r ) => { r.card = Scanners.ref( epi ); } );
` );
check( "a volume is the matrix squared by the slices at 16 bits" , run( "Scanners.ref( epi ).volume_bytes" ) === 96 * 96 * 58 * 2 );
check( "a structural card has no volume size" , run( "Scanners.ref( Object.assign( {} , epi , { role: 'structural' } ) ).volume_bytes" ) === 0 );
check( "a run's data leaves out the dummies" , run( "var i = Timing.run( sized , sized.runs[ 0 ] ); Timing.runBytes( sized , sized.runs[ 0 ] ) === ( i.volumes.max - i.dummy ) * 96 * 96 * 58 * 2" ) );
check( "a run with no card is counted, not guessed" , run( "var u = JSON.parse( JSON.stringify( sized ) ); u.runs.forEach( ( r ) => { r.card = null; } ); var d = Timing.dataVolume( u ); d.total === 0 && d.unsized > 0" ) );
check( "the total is sessions by count by participants" , run( "var v = Timing.dataVolume( sized ); v.total === v.perParticipant * sized.budget.participants" ) );
check( "sizes read in MB and GB" , run( "Timing.size( 5 * 1024 * 1024 ) + ' ' + Timing.size( 3 * 1024 ** 3 )" ) === "5 MB 3.00 GB" );
check( "the console clock" , run( "[ Scanners.clock( 244 ) , Scanners.clock( 1439.9 ) , Scanners.clock( 59.96 ) ].join()" ) === "04:04.0,23:59.9,01:00.0" );
check( "only what differs is offered for writing back" , run( "Scanners.timingChanges( sized , sized.runs[ 0 ] , epi ).length" ) === 3 );
check( "a parameter the card lacks is marked" , run( "var bare = { pages: [ { name: 'P' , rows: [] } ] }; Scanners.timingChanges( sized , sized.runs[ 0 ] , bare ).every( ( c ) => c.missing )" ) );

// Jittered leads.
run( `
  var jd = Schema.normalise( JSON.parse( JSON.stringify( doc ) ) );
  var jr = jd.runs.find( ( r ) => r.blocks.length > 1 );
  var plainLead = Compile.runPlans( jd , X , jr.id , { seed: 7 } )[ 0 ].segments.find( ( s ) => s.kind === 'lead_in' ).duration;
  jr.lead_in.jitter = Object.assign( Schema.duration( 'uniform' , 5 , 9 ) );
  var leadsOf = ( seed ) => Compile.runPlans( jd , X , jr.id , { seed: seed } )[ 0 ].segments.find( ( s ) => s.kind === 'lead_in' ).duration;
` );
check( "a fixed lead is its seconds" , run( "plainLead === jr.lead_in.seconds" ) );
check( "a jittered lead is drawn in range" , run( "[ 1 , 2 , 3 , 4 , 5 , 6 ].every( ( s ) => leadsOf( s ) >= 5 && leadsOf( s ) <= 9 )" ) );
check( "a jittered lead varies" , run( "new Set( [ 1 , 2 , 3 , 4 , 5 , 6 ].map( leadsOf ) ).size" ) > 1 );
check( "a seed gives the same lead" , run( "leadsOf( 3 ) === leadsOf( 3 )" ) );
check( "a run's length range includes its lead's" , run( "Timing.run( jd , jr ).functional.max - Timing.run( jd , jr ).functional.min" ) >= 4 );
check( "jitter survives normalising" , run( "Schema.normalise( jd ).runs.find( ( r ) => r.id === jr.id ).lead_in.jitter.kind" ) === "uniform" );
check( "a run with no jitter keeps none" , run( "Schema.normalise( { name: 'x' , runs: [ { lead_in: { seconds: 3 } } ] } ).runs[ 0 ].lead_in.jitter" ) === null );

// Importing an old design.
const v2 = fs.readFileSync( path.join( __dirname , "old_design_v2.json" ) , "utf8" );
run( "var old = " + v2 + "; var imported = Legacy.convertDesign( old , [] ); var idoc = imported.doc;" );
const question = "old.trials.filter( ( t ) => t.phases.some( ( p ) => p.shows === 'question' && !/audio/i.test( p.name ) ) )";
const others = run( "old.roles.length - 1" );
check( "every condition becomes a trial type" , run( "idoc.trial_types.length" ) === run( "old.trials.length" ) + others * run( question + ".length" ) );
check( "a condition keeps its own cue" , run( "idoc.trial_types.find( ( t ) => t.name.endsWith( '· passive_read' ) && t.phases.some( ( p ) => p.layers.some( ( l ) => l.text === '○' ) ) ) != null" ) );
check( "a condition that hides the question hides it" , run( "idoc.trial_types.filter( ( t ) => t.name.endsWith( '· cue_only' ) ).every( ( t ) => !t.phases.some( ( p ) => p.layers.some( ( l ) => l.text === '{text}' ) ) )" ) );
check( "a condition keeps its response" , run( "idoc.trial_types.find( ( t ) => t.name.endsWith( '· constant_word' ) ).notes" ).includes( "ready" ) );
check( "with no share of trials, runs play only the trial" , run( "idoc.runs.every( ( r ) => r.blocks.every( ( b ) => b.mix.length === 1 ) )" ) );
check( "the old limits become warnings" , run( "idoc.limits.max_run_minutes" ) === 20 && run( "idoc.limits.max_runs_per_session" ) === 8 );
run( "var withShare = JSON.parse( JSON.stringify( old ) ); var asked = withShare.trials.find( ( t ) => /Question Trial/.test( t.name ) ); asked.controlPct = 20; var theRun = withShare.runs.find( ( r ) => r.trial === asked.id ); theRun.trialsPerBlock = 30; theRun.blocksPerRun = 1; var sdoc = Legacy.convertDesign( withShare , [] ).doc; var mix = sdoc.runs.find( ( r ) => r.name === theRun.name ).blocks[ 0 ].mix;" );
check( "a control share reaches the run" , run( "mix.length" ) > 1 );
check( "a control share keeps the block's size" , run( "mix.reduce( ( n , m ) => n + m.count , 0 )" ) === 30 );
check( "a control share is the share asked for" , run( "mix[ 0 ].count" ) === 24 );
run( "var off = JSON.parse( JSON.stringify( old ) ); var offBlock = off.sessions[ 0 ].blocks[ 0 ]; offBlock.enabled = false; var odoc = Legacy.convertDesign( off , [] ).doc;" );
check( "a block switched off stays, switched off" , run( "odoc.sessions[ 0 ].steps.some( ( s ) => s.enabled === false )" ) );

// Session breaks reach the screen between runs.
run( `var bdoc = Schema.normalise( JSON.parse( JSON.stringify( idoc ) ) );
  var brun = bdoc.runs[ 0 ];
  var bses = bdoc.sessions[ 0 ];
  bses.auto_break_minutes = 0;
  bses.steps = [
    { id: 'a' , kind: 'run' , run: brun.id , enabled: true } ,
    { id: 'b' , kind: 'break' , minutes: 2 , enabled: true } ,
    { id: 'c' , kind: 'break' , minutes: 1 , enabled: false } ,
    { id: 'd' , kind: 'scan' , minutes: 5 , enabled: true } ,
    { id: 'e' , kind: 'run' , run: brun.id , enabled: true } ,
    { id: 'f' , kind: 'run' , run: brun.id , enabled: true } ,
    { id: 'g' , kind: 'break' , minutes: 3 , enabled: true } ,
  ];
  var bplans = Compile.sessionPlans( bdoc , { id: 'x' , name: 'x' } , bses.id , { seed: 1 , participant: 'p' , scanner: 'wait' } );` );
check( "a break step goes on the run before it" , run( "bplans[ 0 ].break_after" ) === 120 );
check( "a run with no break after it has none" , run( "bplans[ 1 ].break_after" ) === undefined );
check( "a break after the last run is dropped" , run( "bplans[ 2 ].break_after" ) === undefined );
run( "bses.auto_break_minutes = 1.5; bses.steps = bses.steps.filter( ( s ) => s.kind === 'run' ); var aplans = Compile.sessionPlans( bdoc , { id: 'x' , name: 'x' } , bses.id , { seed: 1 , participant: 'p' , scanner: 'wait' } );" );
check( "an automatic break does too" , run( "aplans[ 0 ].break_after" ) === 90 && run( "aplans[ 1 ].break_after" ) === 90 );

// Which saved version a plan came from.
check( "a plan says which revision it came from" , run( "Compile.sessionPlans( bdoc , { id: 'x' , name: 'x' } , bses.id , { seed: 1 , scanner: 'wait' , revision: 7 } )[ 0 ].revision" ) === 7 );
check( "a plan with no saved revision has none" , run( "'revision' in aplans[ 0 ]" ) === false );

// A response on the trigger key.
run( "var vdoc = Schema.normalise( JSON.parse( JSON.stringify( idoc ) ) ); vdoc.scanner.trigger_key = '5'; vdoc.trial_types[ 0 ].phases[ 0 ].response.keys = [ 'num_5' ];" );
check( "a response on the trigger key is an error" , run( "Validate.check( vdoc ).some( ( p ) => p.level === 'error' && p.text === 'problems.response_is_trigger' )" ) );

if ( failures.length ) {
  console.log( failures.join( "\n" ) );
  process.exit( 1 );
}
