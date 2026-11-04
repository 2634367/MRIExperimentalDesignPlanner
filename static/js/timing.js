// How long things take, and how jittered durations are drawn. This is the
// only implementation of either: the screens size runs and sessions with
// span(), and compile.js draws every duration a run plan contains with
// sample(), so the estimate and what is played can never disagree.
//
// Duration kinds (a phase's duration.kind):
//   fixed        value seconds
//   uniform      anywhere from min to max
//   exponential  min to max, short waits likelier; scale is the mean of the
//                untruncated exponential as a fraction of (max - min)
//   geometric    min plus a whole number of TRs, truncated at max (Ashby,
//                Statistical Analysis of fMRI Data, ch. 5, eq. 5.3): the
//                chance the next event comes on the next TR is always p, so
//                the participant cannot anticipate it -- until the cap
//
// snap_to_tr rounds a uniform or exponential draw to the TR grid.
const Timing = {
  round4( x ) {
    return Math.round( x * 1e4 ) / 1e4;
  },

  // The truncated geometric's rungs: n = 0..nMax extra TRs, P(n) ∝ p(1-p)^n.
  geometric( d , tr ) {
    const lo = d.min;
    const rungs = Math.max( 0 , Math.floor( ( d.max - lo ) / tr + 1e-9 ) );
    const weights = [];
    let total = 0;
    for ( let n = 0; n <= rungs; n += 1 ) {
      const w = d.p * Math.pow( 1 - d.p , n );
      weights.push( w );
      total += w;
    }
    const probs = weights.map( ( w ) => w / total );
    const mean = lo + probs.reduce( ( sum , p , n ) => sum + p * n , 0 ) * tr;
    return { probs: probs , mean: mean , max: lo + rungs * tr , degenerate: rungs === 0 && d.max > lo };
  },

  exponentialMean( d ) {
    const width = d.max - d.min;
    if ( width <= 0 ) return d.min;
    const lam = 1 / ( d.scale * width );
    const tail = Math.exp( -lam * width );
    return d.min + 1 / lam - ( width * tail ) / ( 1 - tail );
  },

  // { min, mean, max } seconds for one duration.
  span( d , tr ) {
    if ( d.kind === "fixed" ) return { min: d.value , mean: d.value , max: d.value };
    if ( d.kind === "geometric" ) {
      const g = this.geometric( d , tr );
      return { min: d.min , mean: g.mean , max: g.max };
    }
    if ( d.kind === "exponential" ) return { min: d.min , mean: this.exponentialMean( d ) , max: d.max };
    return { min: d.min , mean: ( d.min + d.max ) / 2 , max: d.max };
  },

  // One draw, from rng() in [0, 1). Ported from the old task's
  // bank.sample_duration, so a design behaves as it always did.
  sample( d , tr , rng ) {
    if ( d.kind === "fixed" ) return d.value;
    const lo = d.min;
    const hi = d.max;
    if ( d.kind === "geometric" ) {
      const g = this.geometric( d , tr );
      let u = rng();
      for ( let n = 0; n < g.probs.length; n += 1 ) {
        u -= g.probs[ n ];
        if ( u < 0 ) return this.round4( lo + n * tr );
      }
      return this.round4( g.max );
    }
    let value;
    if ( d.kind === "exponential" && hi > lo ) {
      const lam = 1 / ( d.scale * ( hi - lo ) );
      value = lo - Math.log( 1 - rng() * ( 1 - Math.exp( -lam * ( hi - lo ) ) ) ) / lam;
    } else {
      value = lo + rng() * ( hi - lo );
    }
    if ( d.snap_to_tr && tr ) value = Math.max( lo , Math.round( value / tr ) * tr );
    return this.round4( Math.min( value , hi ) );
  },

  add( a , b , times ) {
    const k = times == null ? 1 : times;
    return { min: a.min + b.min * k , mean: a.mean + b.mean * k , max: a.max + b.max * k };
  },
  zero() {
    return { min: 0 , mean: 0 , max: 0 };
  },

  // A run may use its own TR and dummy volumes (a different sequence);
  // 0 and -1 mean the experiment's scanner settings.
  scan( doc , run ) {
    return {
      tr: run && run.tr > 0 ? run.tr : doc.scanner.tr,
      dummy: run && run.dummy_volumes >= 0 ? run.dummy_volumes : doc.scanner.dummy_volumes,
    };
  },

  trial( doc , trialType , tr ) {
    const step = tr || doc.scanner.tr;
    return ( trialType ? trialType.phases : [] ).reduce( ( sum , phase ) => this.add( sum , this.span( phase.duration , step ) ) , this.zero() );
  },

  trialTypeById( doc , id ) {
    return doc.trial_types.find( ( tt ) => tt.id === id ) || null;
  },

  // What one run holds and how long it lasts. functional is from t0 (the
  // trigger the run starts on) to the end of the lead-out; total adds the
  // dummy volumes before it. Rest after a block comes after each repeat of
  // it, except at the very end of the run.
  run( doc , run ) {
    const scan = this.scan( doc , run );
    const tr = scan.tr;
    let functional = { min: run.lead_in.seconds , mean: run.lead_in.seconds , max: run.lead_in.seconds };
    const counts = {};
    let trials = 0;
    const blocks = [];
    const repeats = [];
    run.blocks.forEach( ( block ) => {
      for ( let r = 0; r < block.repeat; r += 1 ) repeats.push( block );
    } );
    run.blocks.forEach( ( block ) => {
      let one = this.zero();
      let n = 0;
      block.mix.forEach( ( entry ) => {
        const tt = this.trialTypeById( doc , entry.trial_type );
        if ( !tt ) return;
        one = this.add( one , this.trial( doc , tt , tr ) , entry.count );
        counts[ tt.id ] = ( counts[ tt.id ] || 0 ) + entry.count * block.repeat;
        n += entry.count;
      } );
      trials += n * block.repeat;
      const restSeconds = block.rest_after.seconds;
      blocks.push( { block: block , trials: n , one: one , rest: restSeconds } );
    } );
    repeats.forEach( ( block , index ) => {
      const info = blocks.find( ( b ) => b.block === block );
      functional = this.add( functional , info.one );
      if ( index < repeats.length - 1 && info.rest > 0 ) functional = this.add( functional , { min: info.rest , mean: info.rest , max: info.rest } );
    } );
    functional = this.add( functional , { min: run.lead_out.seconds , mean: run.lead_out.seconds , max: run.lead_out.seconds } );
    const dummy = scan.dummy * tr;
    return {
      tr: tr,
      dummy: scan.dummy,
      functional: functional,
      total: { min: functional.min + dummy , mean: functional.mean + dummy , max: functional.max + dummy },
      volumes: { min: scan.dummy + Math.ceil( functional.min / tr - 1e-9 ) , max: scan.dummy + Math.ceil( functional.max / tr - 1e-9 ) },
      trials: trials,
      counts: counts,
      blocks: blocks,
    };
  },

  // A session in console order: each step with its span, and the automatic
  // breaks (session.auto_break_minutes) between two run steps that sit
  // directly next to each other. An automatic break has step null.
  items( doc , session ) {
    const out = [];
    const brk = session.auto_break_minutes * 60;
    session.steps.forEach( ( step , index ) => {
      const previous = session.steps[ index - 1 ];
      if ( brk > 0 && step.kind === "run" && previous && previous.kind === "run" ) {
        out.push( { kind: "break" , step: null , auto: true , seconds: { min: brk , mean: brk , max: brk } , run: null } );
      }
      if ( step.kind === "run" ) {
        const run = doc.runs.find( ( r ) => r.id === step.run );
        const info = run ? this.run( doc , run ) : null;
        out.push( { kind: "run" , step: step , auto: false , seconds: info ? info.total : this.zero() , run: run || null , info: info } );
      } else {
        const s = step.minutes * 60;
        out.push( { kind: step.kind , step: step , auto: false , seconds: { min: s , mean: s , max: s } , run: null } );
      }
    } );
    return out;
  },

  // A session's length in seconds, its runs, and its trials by type.
  session( doc , session ) {
    let seconds = this.zero();
    const counts = {};
    let runs = 0;
    let trials = 0;
    this.items( doc , session ).forEach( ( item ) => {
      seconds = this.add( seconds , item.seconds );
      if ( !item.info ) return;
      runs += 1;
      trials += item.info.trials;
      Object.keys( item.info.counts ).forEach( ( id ) => { counts[ id ] = ( counts[ id ] || 0 ) + item.info.counts[ id ]; } );
    } );
    return { seconds: seconds , runs: runs , trials: trials , counts: counts };
  },

  // The whole study against the hours available: every session type times
  // its count per participant, times the participants.
  budget( doc ) {
    const participants = doc.budget.participants;
    let perParticipant = 0;
    const counts = {};
    const rows = doc.sessions.map( ( session ) => {
      const info = this.session( doc , session );
      const hours = ( info.seconds.mean * session.count ) / 3600;
      perParticipant += hours;
      Object.keys( info.counts ).forEach( ( id ) => { counts[ id ] = ( counts[ id ] || 0 ) + info.counts[ id ] * session.count * participants; } );
      return { session: session , info: info , hours: hours };
    } );
    const used = perParticipant * participants;
    return { rows: rows , perParticipant: perParticipant , used: used , available: doc.budget.hours_available , left: doc.budget.hours_available - used , counts: counts };
  },

  // 75 -> "1:15", 3725 -> "1:02:05".
  clock( seconds ) {
    const total = Math.max( 0 , Math.round( seconds ) );
    const h = Math.floor( total / 3600 );
    const m = Math.floor( ( total % 3600 ) / 60 );
    const s = total % 60;
    const pad = ( n ) => String( n ).padStart( 2 , "0" );
    return h > 0 ? h + ":" + pad( m ) + ":" + pad( s ) : m + ":" + pad( s );
  },

  // A span for a label: "4 s", "2–6 s (mean 3.2)".
  describe( span ) {
    const f = ( x ) => ( Math.abs( x - Math.round( x ) ) < 1e-6 ? String( Math.round( x ) ) : x.toFixed( 1 ) );
    if ( Math.abs( span.max - span.min ) < 1e-6 ) return f( span.min ) + " s";
    return f( span.min ) + "–" + f( span.max ) + " s · " + I18n.get( "timing.mean" ) + " " + f( span.mean );
  },

  hours( h ) {
    return ( Math.round( h * 10 ) / 10 ).toFixed( 1 ) + " h";
  },
};
