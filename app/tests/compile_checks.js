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

// Design-wide jitter.
run( `
  var jdoc = Schema.normalise( JSON.parse( JSON.stringify( idoc ) ) );
  jdoc.trial_types[ 0 ].phases = [
    Schema.phase( "A" , Schema.jittered( 2 , 10 ) , Schema.fixation() ),
    Schema.phase( "B" , Object.assign( Schema.duration( "uniform" , 3 , 5 ) ) , Schema.fixation() ),
  ];
  jdoc.scanner.tr = 2;
  jdoc.jitter = { mode: "geometric" , p: 0.25 , scale: 0.5 , cap_trs: 0 };
  jdoc = Schema.normalise( jdoc );
  var inherited = jdoc.trial_types[ 0 ].phases[ 0 ].duration;
  var own = jdoc.trial_types[ 0 ].phases[ 1 ].duration;
` );
check( "a phase takes the design's jitter" , run( "inherited.kind === 'geometric' && inherited.p === 0.25" ) );
check( "a phase with its own jitter keeps it" , run( "own.kind === 'uniform' && own.inherit === false" ) );
run( "jdoc.jitter.mode = 'exponential'; jdoc.jitter.scale = 0.7; jdoc = Schema.normalise( jdoc ); inherited = jdoc.trial_types[ 0 ].phases[ 0 ].duration; own = jdoc.trial_types[ 0 ].phases[ 1 ].duration;" );
check( "changing the design changes those who follow it" , run( "inherited.kind === 'exponential' && inherited.scale === 0.7" ) );
check( "and nobody else" , run( "own.kind === 'uniform'" ) );
check( "a phase keeps its own window" , run( "inherited.min === 2 && inherited.max === 10" ) );
run( "jdoc.jitter = { mode: 'geometric' , p: 0.5 , scale: 0.5 , cap_trs: 2 }; jdoc = Schema.normalise( jdoc ); inherited = jdoc.trial_types[ 0 ].phases[ 0 ].duration;" );
check( "the cap limits a wait to that many TRs" , run( "Timing.span( inherited , 2 ).max" ) === 6 );
check( "sampling obeys the cap" , run( "var capRng = Compile.rng( 3 ); Array.from( { length: 500 } , () => Timing.sample( inherited , 2 , capRng ) ).every( ( x ) => x <= 6 )" ) );
check( "a design with no cap uses the whole window" , run( "Timing.span( Object.assign( {} , inherited , { cap_trs: 0 } ) , 2 ).max" ) === 10 );
run( "var flatTt = { phases: [ { duration: Schema.normalise( { jitter: { mode: 'geometric' , p: 0.5 } , trial_types: [ { phases: [ { duration: { kind: 'uniform' , min: 2 , max: 10 , inherit: true } } ] } ] } ).trial_types[ 0 ].phases[ 0 ].duration } ] }; var flatDoc = { scanner: { tr: 2 } };" );
check( "a geometric wait saves time against a flat one" , run( "Timing.flatDelta( flatDoc , flatTt )" ) < -1 );
check( "a fixed trial is the same as flat" , run( "Timing.flatDelta( flatDoc , { phases: [ { duration: Schema.duration( 'fixed' , 3 ) } ] } )" ) === 0 );
check( "a lead-in can follow the design" , run( `
  var ldoc = Schema.normalise( JSON.parse( JSON.stringify( jdoc ) ) );
  ldoc.runs[ 0 ].lead_in.jitter = Schema.jittered( 4 , 10 );
  ldoc.jitter.mode = "uniform";
  Schema.normalise( ldoc ).runs[ 0 ].lead_in.jitter.kind === "uniform"
` ) );

// Format 3 keeps an old design's timing exactly.
run( `
  var oldJitter = {
    name: "x" , format_version: 2 , scanner: { tr: 2 },
    trial_types: [ { id: "t" , phases: [
      { id: "a" , duration: { kind: "geometric" , min: 2 , max: 8 , p: 0.3 } },
      { id: "b" , duration: { kind: "geometric" , min: 2 , max: 8 , p: 0.3 } },
      { id: "c" , duration: { kind: "geometric" , min: 2 , max: 8 , p: 0.7 } },
      { id: "d" , duration: { kind: "exponential" , min: 1 , max: 3 , scale: 0.4 } },
      { id: "e" , duration: { kind: "fixed" , value: 4 } },
    ] } ],
  };
  var migrated = Schema.normalise( oldJitter );
  var by = ( id ) => migrated.trial_types[ 0 ].phases.find( ( p ) => p.id === id ).duration;
` );
check( "a migrated design takes the commonest jitter" , run( "migrated.jitter.mode === 'geometric' && migrated.jitter.p === 0.3" ) );
check( "those who had it follow it" , run( "by( 'a' ).inherit && by( 'b' ).inherit" ) );
check( "those who differed keep their own" , run( "!by( 'c' ).inherit && by( 'c' ).p === 0.7 && !by( 'd' ).inherit && by( 'd' ).kind === 'exponential'" ) );
check( "a migrated design says format 3" , run( "migrated.format_version" ) === 3 );
check( "migration leaves the document it was given alone" , run( "oldJitter.format_version" ) === 2 );
check( "the study file draws the same trials after migrating" , run( `
  var rawStudy = ${ study };
  var plainly = JSON.parse( JSON.stringify( rawStudy ) );
  Schema.durations( plainly ).forEach( ( d ) => { d.inherit = false; } );
  plainly.format_version = 3;
  var a = Schema.normalise( rawStudy ); var b = Schema.normalise( plainly );
  var r = a.runs.find( ( x ) => x.blocks.length > 1 ).id;
  JSON.stringify( Compile.forServer( Compile.runPlans( a , X , r , { seed: 11 } ) ).map( ( p ) => p.segments ) ) === JSON.stringify( Compile.forServer( Compile.runPlans( b , X , r , { seed: 11 } ) ).map( ( p ) => p.segments ) )
` ) );

// The shared fixation mark.
run( `
  var fdoc = Schema.normalise( { name: "f" , trial_types: [ Schema.trialType( "T" ) ] } );
  fdoc.fixation.layers[ 0 ].text = "x";
  fdoc.fixation.layers[ 0 ].height = 0.2;
  fdoc.runs = [ Schema.run( "R" , fdoc.trial_types[ 0 ].id ) ];
  fdoc = Schema.normalise( fdoc );
  var fplan = Compile.runPlans( fdoc , X , fdoc.runs[ 0 ].id , { seed: 1 } )[ 0 ];
  var everyLayer = fplan.segments.flatMap( ( s ) => s.layers );
` );
check( "a plan never holds a fixation layer" , run( "everyLayer.every( ( l ) => l.kind !== 'fixation' )" ) );
check( "a fixation layer draws the design's mark" , run( "fplan.segments.find( ( s ) => s.phase === 'Fixation' ).layers[ 0 ].text" ) === "x" );
check( "lead-ins show the mark too" , run( "fplan.segments.find( ( s ) => s.kind === 'lead_in' ).layers[ 0 ].height" ) === 0.2 );
check( "the mark cannot show itself" , run( "Schema.normalise( { fixation: { layers: [ { kind: 'fixation' } , { kind: 'text' , text: '+' } ] } } ).fixation.layers.length" ) === 1 );
check( "a mark with a column is an error" , run( "fdoc.fixation.layers[ 0 ].text = '{text}'; Validate.check( fdoc ).some( ( p ) => p.text === 'problems.template_no_list' )" ) );
run( "fdoc.fixation.layers[ 0 ].text = 'x';" );

// What's on screen.
run( `
  var sdoc = Schema.normalise( { name: "s" , trial_types: [ Schema.trialType( "T" ) ] } );
  sdoc.trial_types[ 0 ].phases.push( Schema.phase( "Copy" , Schema.duration( "fixed" , 1 ) , [ Schema.textLayer( "+" , 0.1 ) ] ) );
  sdoc.trial_types[ 0 ].phases.push( Schema.phase( "Copy 2" , Schema.duration( "fixed" , 1 ) , [ Schema.textLayer( "+" , 0.1 ) ] ) );
  sdoc = Schema.normalise( sdoc );
  var copies = Inventory.rows( sdoc ).find( ( r ) => r.layer.text === "+" );
` );
check( "copies count as one row" , run( "copies.count" ) === 2 );
check( "a row says where it is" , run( "copies.places.length" ) === 2 );
check( "a template cannot become the mark" , run( "!Inventory.linkable( Schema.textLayer( '{text}' ) )" ) );
run( "Inventory.adopt( sdoc , copies.signature ); sdoc = Schema.normalise( sdoc );" );
check( "adopting a copy makes it the mark" , run( "sdoc.fixation.layers[ 0 ].height" ) === 0.1 );
check( "and links its copies" , run( "!Inventory.rows( sdoc ).some( ( r ) => r.layer.kind === 'text' && r.layer.text === '+' )" ) );
check( "linking changes nothing else" , run( "Inventory.rows( sdoc ).some( ( r ) => r.layer.kind === 'text' && r.layer.text === '{text}' )" ) );
check( "nothing is linked until asked" , run( `
  var plain = Schema.normalise( { format_version: 2 , name: "p" , trial_types: [ { phases: [ { layers: [ { kind: "text" , text: "+" , height: 0.08 } ] } ] } ] } );
  plain.trial_types[ 0 ].phases[ 0 ].layers[ 0 ].kind === "text"
` ) );

// A step repeated.
run( `
  var rdoc = Schema.normalise( JSON.parse( JSON.stringify( bdoc ) ) );
  var rses = rdoc.sessions.find( ( s ) => s.steps.some( ( st ) => st.kind === "run" ) );
  var rstep = rses.steps.find( ( st ) => st.kind === "run" );
  rses.auto_break_minutes = 0;
  var beforeRepeat = Compile.sessionPlans( rdoc , X , rses.id , { seed: 5 } ).length;
  var lengthBefore = Timing.session( rdoc , rses ).seconds.mean;
  var oneRun = Timing.run( rdoc , rdoc.runs.find( ( r ) => r.id === rstep.run ) ).total.mean;
  rstep.repeat = 3;
  var repeated = Compile.sessionPlans( rdoc , X , rses.id , { seed: 5 } );
` );
check( "a run ×3 plays as three runs" , run( "repeated.length" ) === run( "beforeRepeat" ) + 2 );
check( "each has its own label" , run( "new Set( repeated.map( ( p ) => p.run.label ) ).size === repeated.length" ) );
check( "each draws its own trials" , run( `
  var edoc = Schema.example( "E" );
  edoc.sessions[ 0 ].steps = [ Object.assign( Schema.step( "run" , edoc.runs[ 0 ].id ) , { repeat: 2 } ) ];
  var twice = Compile.sessionPlans( edoc , X , edoc.sessions[ 0 ].id , { seed: 5 } );
  twice.length === 2 && JSON.stringify( twice[ 0 ].segments.map( ( s ) => s.duration ) ) !== JSON.stringify( twice[ 1 ].segments.map( ( s ) => s.duration ) )
` ) );
check( "repeats take their time" , Math.abs( run( "Timing.session( rdoc , rses ).seconds.mean - lengthBefore - 2 * oneRun" ) ) < 1e-6 );
check( "a repeat gets the automatic break" , run( "rses.auto_break_minutes = 2; Timing.items( rdoc , rses ).filter( ( i ) => i.auto ).length" ) >= 2 );
check( "a repeat survives saving" , run( "Schema.normalise( JSON.parse( JSON.stringify( rdoc ) ) ).sessions.find( ( s ) => s.id === rses.id ).steps.find( ( st ) => st.id === rstep.id ).repeat" ) === 3 );
check( "a repeat is at least one" , run( "Schema.normalise( { sessions: [ { steps: [ { kind: 'break' , repeat: 0 } ] } ] } ).sessions[ 0 ].steps[ 0 ].repeat" ) === 1 );
check( "a repeat draws on the list like the runs it stands for" , run( `
  var tdoc = Schema.normalise( JSON.parse( JSON.stringify( rdoc ) ) );
  var list = Schema.list( "L" ); list.items = [ Schema.item( { text: "a" } ) , Schema.item( { text: "b" } ) ];
  var tt = Schema.trialType( "T" ); tt.list = list.id; tt.no_repeat = "session";
  var run1 = Schema.run( "R" , tt.id ); run1.blocks[ 0 ].mix[ 0 ].count = 2;
  var one = Object.assign( Schema.step( "run" , run1.id ) , { repeat: 2 } );
  var ses = Schema.session( "S" ); ses.steps = [ one ];
  tdoc.lists = [ list ]; tdoc.trial_types = [ tt ]; tdoc.runs = [ run1 ]; tdoc.sessions = [ ses ];
  Validate.check( Schema.normalise( tdoc ) ).some( ( p ) => p.text === "problems.list_too_short" )
` ) );

// Functional and overhead hours, and the calendar.
run( `
  var hdoc = Schema.normalise( JSON.parse( JSON.stringify( bdoc ) ) );
  var hses = hdoc.sessions.find( ( s ) => s.steps.some( ( st ) => st.kind === "run" ) );
  hdoc.sessions = [ hses ];
  hses.count = 2;
  hses.steps.push( Object.assign( Schema.step( "break" ) , { minutes: 60 } ) );
  hdoc.budget.participants = 3;
  hdoc = Schema.normalise( hdoc );
  var charged = Timing.budget( hdoc );
` );
check( "overhead is what is not a run" , run( "Math.abs( charged.overhead - ( Timing.session( hdoc , hdoc.sessions[ 0 ] ).overhead * 2 * 3 / 3600 ) ) < 1e-9 && charged.overhead >= 6" ) );
check( "by default all of it is charged" , run( "Math.abs( charged.used - charged.functional - charged.overhead ) < 1e-9" ) );
run( "hdoc.budget.count_overhead = false; var free = Timing.budget( hdoc );" );
check( "with the toggle off, only functional time is charged" , run( "Math.abs( free.used - free.functional ) < 1e-9 && free.used < charged.used" ) );
check( "overhead is still reported" , run( "free.overhead === charged.overhead" ) );
check( "a calendar with nothing set says nothing" , run( "hdoc.budget.sessions_per_week = 0; hdoc.budget.weeks_available = 0; Timing.calendar( hdoc ).set === false && Timing.calendar( hdoc ).fits" ) );
run( "hdoc.budget.sessions_per_week = 2; hdoc.budget.weeks_available = 2;" );
check( "weeks needed rounds up" , run( "Timing.calendar( hdoc ).weeksNeeded" ) === 3 );
check( "a study that does not fit warns" , run( "Validate.check( hdoc ).some( ( p ) => p.text === 'problems.over_calendar' && p.level === 'warning' )" ) );
run( "hdoc.budget.weeks_available = 3;" );
check( "a study that fits does not" , run( "!Validate.check( hdoc ).some( ( p ) => p.text === 'problems.over_calendar' )" ) );

// When the run clock starts.
run( "var cdoc = Schema.normalise( JSON.parse( JSON.stringify( bdoc ) ) ); cdoc.scanner.dummy_volumes = 4; cdoc.runs.forEach( ( r ) => { r.dummy_volumes = -1; } ); var crun = cdoc.runs[ 0 ].id; var lastDummy = Compile.runPlans( cdoc , X , crun , { seed: 1 , scanner: 'wait' } )[ 0 ];" );
check( "by default the plan waits for the dummies" , run( "lastDummy.scanner.dummy_volumes === 4 && !( 't0' in lastDummy.scanner )" ) );
run( "cdoc.scanner.t0 = 'first_pulse'; var firstPulse = Compile.runPlans( cdoc , X , crun , { seed: 1 , scanner: 'wait' } )[ 0 ];" );
check( "first pulse means no pulses to wait for" , run( "firstPulse.scanner.dummy_volumes === 0 && firstPulse.scanner.t0 === 'first_pulse'" ) );
check( "and the same run" , run( "firstPulse.total_seconds === lastDummy.total_seconds" ) );
check( "the plan counts the pulses to expect" , run( "firstPulse.volumes" ) === run( "lastDummy.volumes" ) - 4 );
check( "the dialog counts what the Runs screen does" , run( "Compile.acquired( cdoc , firstPulse ) === Compile.acquired( cdoc , lastDummy ) && Compile.acquired( cdoc , lastDummy ) === lastDummy.volumes" ) );
run( "cdoc.scanner.t0 = 'after_dummies'; var afterDummies = Compile.runPlans( cdoc , X , crun , { seed: 1 , scanner: 'wait' } )[ 0 ];" );
check( "the pulse after the dummies waits for one more" , run( "afterDummies.scanner.dummy_volumes === 5 && afterDummies.scanner.t0 === 'after_dummies'" ) );
check( "and that pulse is a real volume, so the scan is no longer" , run( "afterDummies.volumes" ) === run( "lastDummy.volumes" ) );
check( "and the dialog agrees" , run( "Compile.acquired( cdoc , afterDummies ) === lastDummy.volumes" ) );
check( "a setting that does not exist falls back" , run( "Schema.normalise( { scanner: { t0: 'nonsense' } } ).scanner.t0" ) === "last_dummy" );
run( "cdoc.scanner.t0 = 'first_pulse';" );
check( "a run still costs its dummy time" , run( "Timing.run( cdoc , cdoc.runs[ 0 ] ).dummy" ) === 4 );

// The locked order.
check( "a design starts with nothing locked" , run( "Schema.normalise( {} ).schedule.seed" ) === 0 );
check( "a lock survives saving" , run( "Schema.normalise( JSON.parse( JSON.stringify( Schema.normalise( { schedule: { seed: 42 , shuffled_at: 'then' , shuffled_by: 'me' } } ) ) ) ).schedule.seed" ) === 42 );
run( `
  var odoc = Schema.example( "O" );
  var drawn = ( seed ) => Compile.lockedGroups( odoc , X , { seed: seed , scanner: "wait" } );
  var same = ( groups ) => JSON.stringify( groups.map( ( g ) => g.plans.map( ( p ) => p.segments ) ) );
  var groups = drawn( 7 );
  var rows = Compile.schedule( groups[ 0 ].plans );
` );
check( "the same seed draws the same order" , run( "same( drawn( 7 ) ) === same( groups )" ) );
check( "another seed draws another" , run( "same( drawn( 8 ) ) !== same( groups )" ) );
check( "each session and each run is on the list" , run( "groups.map( ( g ) => g.kind ).join()" ) === "session,run" );
check( "the list has every trial, counted from 1" , run( "rows.length === groups[ 0 ].plans.reduce( ( n , p ) => n + new Set( p.segments.filter( ( s ) => s.kind === 'phase' ).map( ( s ) => s.trial ) ).size , 0 ) && rows[ 0 ].trial === 1" ) );
check( "a row's phases add up to the plan's" , run( `
  var plan = groups[ 0 ].plans[ 0 ];
  var first = plan.segments.filter( ( s ) => s.trial === 0 );
  rows[ 0 ].onset === first[ 0 ].onset && JSON.stringify( rows[ 0 ].phases.map( ( p ) => p.duration ) ) === JSON.stringify( first.map( ( s ) => s.duration ) )
` ) );
check( "the full list has every segment and a header" , run( `
  var csv = Compile.scheduleCsv( groups ).trim().split( "\\r\\n" );
  csv[ 0 ].startsWith( "played_as,run,kind" ) && csv.length - 1 === groups.reduce( ( n , g ) => n + g.plans.reduce( ( m , p ) => m + p.segments.filter( ( s ) => s.kind !== "instructions" ).length , 0 ) , 0 )
` ) );
check( "a comma in the list stays one cell" , run( "Compile.scheduleCsv( [ { name: 'a,b' , plans: [ { run: { label: 'r' } , segments: [ { kind: 'phase' , trial_type: 'say \"hi\"' , onset: 0 , duration: 1 } ] } ] } ] ).split( '\\r\\n' )[ 1 ]" ) === '"a,b",r,phase,,,"say ""hi""",,,0,1' );
check( "a cell cannot run as a formula" , run( "Compile.scheduleCsv( [ { name: '=1+1' , plans: [ { run: { label: 'r' } , segments: [ { kind: 'phase' , onset: -1 , duration: 1 } ] } ] } ] ).split( '\\r\\n' )[ 1 ]" ) === "'=1+1,r,phase,,,,,,-1,1" );

// What a card keeps.
run( `
  var card = { id: "c" , label: "EPI" , role: "functional" , pages: [ { name: "P" , rows: [
    { parameter: "Act. TR/TE (ms)" , value: "2000 / 36" }, { parameter: "ACQ voxel MPS (mm)" , value: "2.48 / 2.51 / 2.50" },
    { parameter: "slices" , value: "58" }, { parameter: "MB Factor" , value: "2" }, { parameter: "Flip angle (deg)" , value: "90" },
    { parameter: "technique" , value: "FFE" }, { parameter: "Fast Imaging mode" , value: "EPI" },
  ] } ] };
  var ref = Scanners.ref( card );
  var kept = Schema.normalise( { runs: [ { card: ref } ] } ).runs[ 0 ].card;
  var acquired = Scanners.acquisition( kept );
` );
check( "a snapshot keeps the acquisition" , run( "kept.te_ms === 36 && kept.flip === '90' && kept.mb === '2'" ) );
check( "the sequence reads as the console says" , run( "acquired.sequence" ) === "EPI (FFE)" );
check( "voxels read as a size" , run( "acquired.voxel" ) === "2.48 × 2.51 × 2.50" );
check( "TR comes back in ms" , run( "acquired.tr_ms" ) === 2000 );
check( "an old snapshot is not stale for what it never kept" , run( `
  Scanners.cards = [ card ]; Scanners.loaded = true;
  var older = Object.assign( {} , ref , { te_ms: 0 , voxel: "" , slices: "" , mb: "" , flip: "" , sequence: "" } );
  !Scanners.stale( older ) && Scanners.acquisition( older ).te_ms === 36
` ) );
check( "a changed TE is stale" , run( "Scanners.stale( Object.assign( {} , ref , { te_ms: 30 } ) )" ) );

// Importing the old planner's fields.
run( `
  var oldFile = {
    meta: { studyTitle: "Old" , investigator: "A. Person" , institution: "Uni" , designId: "-" , notes: "n" },
    budget: { totalScannerHours: 50 , sessionsPerWeek: 3 , weeksAvailable: 30 , countOverheadAgainstBudget: false },
    jitter: { mode: "geometric" , p: 0.4 , truncation: "trs" , nMaxCap: 2 },
    presentation: { fixation: { text: "o" , height: 0.1 } },
    trials: [ { id: "t" , name: "T" , phases: [ { name: "Wait" , shows: "fixation" , min: 2 , max: 10 , jitter: true } ] } ],
    runs: [] , sessions: [ { id: "s" , name: "S" , blocks: [ { kind: "break" , label: "b" , minutes: 5 , count: 3 } ] } ],
  };
  var imported = Legacy.convertDesign( oldFile , [] ).doc;
` );
check( "the old identity comes across" , run( "imported.meta.investigator === 'A. Person' && imported.meta.institution === 'Uni' && imported.meta.design_id === ''" ) );
check( "and stays out of the notes" , run( "imported.notes" ) === "n" );
check( "the old calendar comes across" , run( "imported.budget.sessions_per_week === 3 && imported.budget.weeks_available === 30" ) );
check( "the old overhead toggle comes across" , run( "imported.budget.count_overhead" ) === false );
check( "the old jitter is the design's" , run( "imported.jitter.mode === 'geometric' && imported.jitter.p === 0.4 && imported.jitter.cap_trs === 2" ) );
check( "old phases follow it" , run( "imported.trial_types[ 0 ].phases[ 0 ].duration.inherit" ) === true );
check( "the old fixation is the design's mark" , run( "imported.fixation.layers[ 0 ].text === 'o' && imported.trial_types[ 0 ].phases[ 0 ].layers[ 0 ].kind === 'fixation'" ) );
check( "an old count becomes a repeat" , run( "imported.sessions[ 0 ].steps.length === 1 && imported.sessions[ 0 ].steps[ 0 ].repeat === 3" ) );

if ( failures.length ) {
  console.log( failures.join( "\n" ) );
  process.exit( 1 );
}
