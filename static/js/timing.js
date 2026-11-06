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
//   geometric    min plus a whole number of TRs, truncated at max or at
//                cap_trs TRs, whichever is sooner (Ashby, Statistical
//                Analysis of fMRI Data, ch. 5, eq. 5.3): the chance the next
//                event comes on the next TR is always p, so the participant
//                cannot anticipate it -- until the cap
//
// snap_to_tr rounds a uniform or exponential draw to the TR grid.
const Timing = {
  round4( x ) {
    return Math.round( x * 1e4 ) / 1e4;
  },

  // The truncated geometric's rungs: n = 0..nMax extra TRs, P(n) ∝ p(1-p)^n.
  geometric( d , tr ) {
    const lo = d.min;
    const window = Math.max( 0 , Math.floor( ( d.max - lo ) / tr + 1e-9 ) );
    const rungs = d.cap_trs > 0 ? Math.min( window , d.cap_trs ) : window;
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

  // The share of trials that land on a geometric wait's last rung, where the
  // chance of the event on the next TR is no longer p but certain, so an
  // ideal observer can anticipate it. null when there is no such rung.
  anticipatable( d , tr ) {
    if ( d.kind !== "geometric" ) return null;
    const probs = this.geometric( d , tr ).probs;
    return probs.length > 1 ? probs[ probs.length - 1 ] : null;
  },

  // A lead-in or lead-out's { min, mean, max }, and one draw of it.
  leadSpan( lead , tr ) {
    return lead.jitter ? this.span( lead.jitter , tr ) : { min: lead.seconds , mean: lead.seconds , max: lead.seconds };
  },
  leadDraw( lead , tr , rng ) {
    return lead.jitter ? this.sample( lead.jitter , tr , rng ) : lead.seconds;
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
    let functional = this.leadSpan( run.lead_in , tr );
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
    functional = this.add( functional , this.leadSpan( run.lead_out , tr ) );
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

  // The steps that happen. A step switched off stays in the design but
  // takes no time and plays nothing, as if it were not there.
  activeSteps( session ) {
    return session.steps.filter( ( step ) => step.enabled !== false );
  },

  // Those steps in the order they happen, a step repeated N times listed N
  // times, so a run x3 is simply three runs from here on.
  playedSteps( session ) {
    return [].concat( ...this.activeSteps( session ).map( ( step ) => Array( step.repeat || 1 ).fill( step ) ) );
  },

  // A session in console order: each step with its span, and the automatic
  // breaks (session.auto_break_minutes) between two run steps that sit
  // directly next to each other. An automatic break has step null.
  items( doc , session ) {
    const out = [];
    const brk = session.auto_break_minutes * 60;
    const steps = this.playedSteps( session );
    steps.forEach( ( step , index ) => {
      const previous = steps[ index - 1 ];
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
  // functional is the mean seconds spent in runs, overhead everything else:
  // setup, structurals and breaks.
  session( doc , session ) {
    let seconds = this.zero();
    const counts = {};
    let runs = 0;
    let trials = 0;
    let functional = 0;
    this.items( doc , session ).forEach( ( item ) => {
      seconds = this.add( seconds , item.seconds );
      if ( item.kind === "run" ) functional += item.seconds.mean;
      if ( !item.info ) return;
      runs += 1;
      trials += item.info.trials;
      Object.keys( item.info.counts ).forEach( ( id ) => { counts[ id ] = ( counts[ id ] || 0 ) + item.info.counts[ id ]; } );
    } );
    return { seconds: seconds , runs: runs , trials: trials , counts: counts , functional: functional , overhead: seconds.mean - functional };
  },

  // The whole study against the hours available: every session type times
  // its count per participant, times the participants. A row's hours are what
  // it charges; with count_overhead off that is only its functional time, and
  // overhead is still reported but costs nothing.
  budget( doc ) {
    const participants = doc.budget.participants;
    let perParticipant = 0;
    let functional = 0;
    let overhead = 0;
    const counts = {};
    const rows = doc.sessions.map( ( session ) => {
      const info = this.session( doc , session );
      const functionalHours = ( info.functional * session.count ) / 3600;
      const overheadHours = ( info.overhead * session.count ) / 3600;
      const hours = doc.budget.count_overhead ? functionalHours + overheadHours : functionalHours;
      perParticipant += hours;
      functional += functionalHours;
      overhead += overheadHours;
      Object.keys( info.counts ).forEach( ( id ) => { counts[ id ] = ( counts[ id ] || 0 ) + info.counts[ id ] * session.count * participants; } );
      return { session: session , info: info , hours: hours , functionalHours: functionalHours , overheadHours: overheadHours };
    } );
    const used = perParticipant * participants;
    return {
      rows: rows , perParticipant: perParticipant , used: used , available: doc.budget.hours_available , left: doc.budget.hours_available - used , counts: counts,
      functional: functional * participants , overhead: overhead * participants,
    };
  },

  // Scanner sessions against the booking: every participant's sessions, at
  // sessions_per_week. Both must be set to say anything.
  calendar( doc ) {
    const perWeek = doc.budget.sessions_per_week;
    const sessions = doc.sessions.reduce( ( sum , session ) => sum + session.count , 0 ) * doc.budget.participants;
    const weeksNeeded = perWeek > 0 ? Math.ceil( sessions / perWeek - 1e-9 ) : 0;
    return { sessions: sessions , weeksNeeded: weeksNeeded , weeksAvailable: doc.budget.weeks_available , set: perWeek > 0 , fits: !( perWeek > 0 && doc.budget.weeks_available > 0 ) || weeksNeeded <= doc.budget.weeks_available };
  },

  // Per trial, how much a jittered phase's mean differs from the middle of
  // its window, which is what a flat (uniform) draw would average. Negative
  // saves time. Only a trial type's jittered phases count.
  flatDelta( doc , tt , tr ) {
    const step = tr || doc.scanner.tr;
    return tt.phases.reduce( ( sum , phase ) => {
      const d = phase.duration;
      return d.kind === "fixed" ? sum : sum + this.span( d , step ).mean - ( d.min + d.max ) / 2;
    } , 0 );
  },

  // Raw functional data: a run's dynamics at its card's size per volume (see
  // Scanners.ref). A run with no such card cannot be sized, so it is counted
  // rather than guessed at.
  runBytes( doc , run ) {
    const info = this.run( doc , run );
    return ( run.card ? run.card.volume_bytes : 0 ) * Math.max( 0 , info.volumes.max - info.dummy );
  },

  sessionData( doc , session ) {
    let bytes = 0;
    let unsized = 0;
    this.items( doc , session ).forEach( ( item ) => {
      if ( !item.run ) return;
      const size = this.runBytes( doc , item.run );
      bytes += size;
      if ( !size ) unsized += 1;
    } );
    return { bytes: bytes , unsized: unsized };
  },

  // Every session type at its count, for one participant and for all.
  dataVolume( doc ) {
    const rows = doc.sessions.map( ( session ) => Object.assign( { session: session , runs: this.session( doc , session ).runs } , this.sessionData( doc , session ) ) );
    const perParticipant = rows.reduce( ( sum , row ) => sum + row.bytes * row.session.count , 0 );
    return { rows: rows , perParticipant: perParticipant , total: perParticipant * doc.budget.participants , unsized: rows.reduce( ( sum , row ) => sum + row.unsized , 0 ) };
  },

  // 1.2 GB, 340 MB: binary units, as the old planner reported them.
  size( bytes ) {
    const mb = bytes / ( 1024 * 1024 );
    return mb >= 1024 ? ( mb / 1024 ).toFixed( mb >= 102400 ? 0 : 2 ) + " GB" : Math.round( mb ) + " MB";
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
