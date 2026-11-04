// What the HRF does to a design: how a trial's modelled phases overlap once
// convolved, and how well a whole run lets each one be estimated. Every
// phase marked "modelled" is one regressor, named after its trial type and
// itself, so each trial type is its own condition.
//
// A run is measured on a real draw of it (Compile, with a fixed seed), so
// the jitter, the trial order and the rests are exactly what would be
// played. The design matrix is sampled at the TR from the trigger on, with
// an intercept and linear and quadratic drift alongside the regressors.
// Efficiency is 1 / (c' (X'X)^-1 c): bigger is better, and only comparable
// between designs with the same HRF and TR.
const Efficiency = {
  MAX_VOLUMES: 4000,
  MAX_LSA: 64,
  PLOT_POINTS: 6000,

  // The modelled phases of the document, in trial-type order.
  regressors( doc ) {
    const out = [];
    doc.trial_types.forEach( ( tt ) => tt.phases.forEach( ( phase ) => {
      if ( !phase.modelled ) return;
      out.push( {
        key: tt.id + ":" + phase.id , trial_type: tt , phase: phase ,
        label: ( tt.name || I18n.get( "trials.unnamed" ) ) + " · " + ( phase.name || I18n.get( "trials.unnamed_phase" ) ),
      } );
    } ) );
    return out;
  },

  // -- one trial ------------------------------------------------------------

  // A trial type laid out back to back repeats times at its mean phase
  // durations, and the predicted response to each modelled phase.
  trial( doc , tt , repeats ) {
    const p = doc.hrf;
    const n = repeats || 2;
    const spans = tt.phases.map( ( phase ) => Timing.span( phase.duration , doc.scanner.tr ).mean );
    const starts = [];
    let period = 0;
    spans.forEach( ( s ) => { starts.push( period ); period += s; } );
    const dt = 0.1;
    const end = period * n + p.span;
    const t = [];
    for ( let x = 0; x <= end + 1e-9; x += dt ) t.push( Math.round( x * 10 ) / 10 );
    const traces = [];
    tt.phases.forEach( ( phase , index ) => {
      if ( !phase.modelled ) return;
      const onset = starts[ index ];
      const dur = spans[ index ];
      const values = t.map( ( x ) => {
        let v = 0;
        for ( let r = 0; r < n; r += 1 ) v += Hrf.boxcar( x , onset + r * period , dur , p );
        return v;
      } );
      // The isolated response peaks this long after its onset.
      let peakAt = 0;
      let peak = 0;
      for ( let x = 0; x <= p.span; x += 0.1 ) {
        const v = Hrf.boxcar( x , 0 , dur , p );
        if ( v > peak ) { peak = v; peakAt = x; }
      }
      traces.push( {
        phase: phase , label: phase.name || I18n.get( "trials.unnamed_phase" ) , onset: onset , duration: dur ,
        values: values , peak: Hrf.peak( dur , p ) , peakTime: onset + peakAt ,
        windows: Array.from( { length: n } , ( _ , r ) => [ onset + r * period , onset + r * period + dur ] ),
        // What is left of this trial's response when the same phase comes
        // round again in the next trial.
        carryover: period > 0 ? Hrf.residualAt( dur , period , p ) : 0,
      } );
    } );
    // Each trace's own response under the next modelled phase's peak.
    traces.forEach( ( trace , i ) => {
      const next = traces[ i + 1 ];
      trace.bleed = next ? Hrf.residualAt( trace.duration , next.peakTime - trace.onset , p ) : null;
      trace.gap = next ? next.peakTime - trace.peakTime : null;
    } );
    const gaps = traces.map( ( x ) => x.gap ).filter( ( x ) => x != null );
    const bleeds = traces.map( ( x ) => x.bleed ).filter( ( x ) => x != null );
    return {
      t: t , period: period , repeats: n , starts: starts , spans: spans , traces: traces ,
      closestGap: gaps.length ? Math.min( ...gaps ) : null,
      worstBleed: bleeds.length ? Math.max( ...bleeds ) : null,
      worstCarryover: traces.length ? Math.max( ...traces.map( ( x ) => x.carryover ) ) : null,
    };
  },

  // -- one run ---------------------------------------------------------------

  run( doc , run , seed ) {
    const p = doc.hrf;
    const plan = Compile.runPlans( doc , { id: "" } , run.id , { seed: seed , scanner: "simulate" , instructions: false } )[ 0 ];
    const tr = plan.scanner.tr;
    const regs = this.regressors( doc );
    const index = new Map( regs.map( ( r , i ) => [ r.key , i ] ) );
    const events = [];
    plan.segments.forEach( ( segment , i ) => {
      const from = plan.trace[ i ];
      if ( !from ) return;
      const reg = index.get( from.trial_type + ":" + from.phase );
      if ( reg === undefined ) return;
      events.push( { reg: reg , onset: segment.onset , duration: segment.duration , trial: segment.trial } );
    } );
    const used = regs.map( ( _ , i ) => events.some( ( e ) => e.reg === i ) );
    const columnsUsed = regs.filter( ( _ , i ) => used[ i ] );
    const volumes = Math.min( this.MAX_VOLUMES , Math.max( 1 , Math.ceil( plan.total_seconds / tr - 1e-9 ) ) );
    const result = {
      plan: plan , tr: tr , volumes: volumes , total: plan.total_seconds , regressors: columnsUsed ,
      events: [] , contrasts: [] , correlations: [] , vif: [] , maxVif: null , maxCorrelation: null ,
      duty: 0 , singleTrial: 0 , series: null ,
    };
    if ( !columnsUsed.length ) return result;
    const remap = new Map();
    regs.forEach( ( _ , i ) => { if ( used[ i ] ) remap.set( i , remap.size ); } );
    result.events = events.map( ( e ) => Object.assign( {} , e , { reg: remap.get( e.reg ) } ) );

    const column = ( list ) => {
      const c = new Float64Array( volumes );
      list.forEach( ( e ) => {
        const start = Math.max( 0 , Math.floor( e.onset / tr ) );
        const stop = Math.min( volumes , Math.ceil( ( e.onset + e.duration + p.span ) / tr ) + 1 );
        for ( let k = start; k < stop; k += 1 ) c[ k ] += Hrf.boxcar( k * tr , e.onset , e.duration , p );
      } );
      return c;
    };
    const task = columnsUsed.map( ( _ , i ) => column( result.events.filter( ( e ) => e.reg === i ) ) );
    const drift = this.drift( volumes );
    const X = task.concat( drift );
    const inverse = this.invert( this.gram( X ) );
    const width = X.length;
    const contrast = ( weights ) => {
      const c = new Array( width ).fill( 0 );
      weights.forEach( ( [ i , w ] ) => { c[ i ] = w; } );
      return inverse ? this.contrastEfficiency( inverse , c ) : 0;
    };
    columnsUsed.forEach( ( reg , i ) => result.contrasts.push( { label: reg.label , vs: null , efficiency: contrast( [ [ i , 1 ] ] ) } ) );
    // Differences between conditions: regressors from different trial types.
    for ( let a = 0; a < columnsUsed.length && result.contrasts.length < 40; a += 1 ) {
      for ( let b = a + 1; b < columnsUsed.length && result.contrasts.length < 40; b += 1 ) {
        if ( columnsUsed[ a ].trial_type === columnsUsed[ b ].trial_type ) continue;
        result.contrasts.push( { label: columnsUsed[ a ].label , vs: columnsUsed[ b ].label , efficiency: contrast( [ [ a , 1 ] , [ b , -1 ] ] ) } );
      }
    }
    result.correlations = task.map( ( a , i ) => task.map( ( b , j ) => ( i === j ? 1 : this.correlation( a , b ) ) ) );
    if ( task.length > 1 ) {
      const ri = this.invert( result.correlations );
      result.vif = ri ? ri.map( ( row , i ) => row[ i ] ) : task.map( () => Infinity );
      result.maxVif = Math.max( ...result.vif );
      let worst = 0;
      result.correlations.forEach( ( row , i ) => row.forEach( ( r , j ) => { if ( i !== j ) worst = Math.max( worst , Math.abs( r ) ); } ) );
      result.maxCorrelation = worst;
    } else {
      result.vif = [ 1 ];
    }
    result.duty = plan.total_seconds > 0 ? result.events.reduce( ( sum , e ) => sum + e.duration , 0 ) / plan.total_seconds : 0;
    result.singleTrial = this.singleTrial( result.events , volumes , tr , drift , p );
    result.series = this.series( result.events , columnsUsed.length , plan.total_seconds , p );
    return result;
  },

  // Least-squares-all: one column per modelled event (up to MAX_LSA of them,
  // evenly spread). The mean variance of those betas is what trial-by-trial
  // analysis pays; its inverse is reported.
  singleTrial( events , volumes , tr , drift , p ) {
    if ( events.length < 2 ) return 0;
    const step = Math.max( 1 , Math.ceil( events.length / this.MAX_LSA ) );
    const picked = events.filter( ( _ , i ) => i % step === 0 );
    if ( picked.length < 2 ) return 0;
    const columns = picked.map( ( e ) => {
      const c = new Float64Array( volumes );
      const start = Math.max( 0 , Math.floor( e.onset / tr ) );
      const stop = Math.min( volumes , Math.ceil( ( e.onset + e.duration + p.span ) / tr ) + 1 );
      for ( let k = start; k < stop; k += 1 ) c[ k ] = Hrf.boxcar( k * tr , e.onset , e.duration , p );
      return c;
    } ).concat( drift );
    const xtx = this.gram( columns );
    xtx.forEach( ( row , i ) => { row[ i ] += 1e-8; } );
    const inverse = this.invert( xtx );
    if ( !inverse ) return 0;
    let total = 0;
    for ( let i = 0; i < picked.length; i += 1 ) total += inverse[ i ][ i ];
    const mean = total / picked.length;
    return mean > 0 ? 1 / mean : 0;
  },

  // Each regressor finely sampled, for the plot.
  series( events , count , total , p ) {
    const end = total + p.span / 2;
    const dt = Math.max( 0.1 , end / this.PLOT_POINTS );
    const n = Math.floor( end / dt ) + 1;
    const t = Array.from( { length: n } , ( _ , i ) => Math.round( i * dt * 1000 ) / 1000 );
    const values = Array.from( { length: count } , () => new Float64Array( n ) );
    events.forEach( ( e ) => {
      const start = Math.max( 0 , Math.floor( e.onset / dt ) );
      const stop = Math.min( n , Math.ceil( ( e.onset + e.duration + p.span ) / dt ) + 1 );
      for ( let k = start; k < stop; k += 1 ) values[ e.reg ][ k ] += Hrf.boxcar( t[ k ] , e.onset , e.duration , p );
    } );
    return { t: t , values: values.map( ( v ) => Array.from( v ) ) };
  },

  // -- linear algebra ------------------------------------------------------

  drift( volumes ) {
    const intercept = new Float64Array( volumes ).fill( 1 );
    const linear = new Float64Array( volumes );
    const quadratic = new Float64Array( volumes );
    for ( let k = 0; k < volumes; k += 1 ) {
      const x = volumes > 1 ? ( 2 * k ) / ( volumes - 1 ) - 1 : 0;
      linear[ k ] = x;
      quadratic[ k ] = 1.5 * x * x - 0.5;
    }
    return [ intercept , linear , quadratic ];
  },

  gram( columns ) {
    const n = columns.length;
    const out = Array.from( { length: n } , () => new Array( n ).fill( 0 ) );
    for ( let a = 0; a < n; a += 1 ) {
      for ( let b = a; b < n; b += 1 ) {
        let total = 0;
        const ca = columns[ a ];
        const cb = columns[ b ];
        for ( let k = 0; k < ca.length; k += 1 ) total += ca[ k ] * cb[ k ];
        out[ a ][ b ] = total;
        out[ b ][ a ] = total;
      }
    }
    return out;
  },

  // Gauss-Jordan with partial pivoting; null if singular.
  invert( matrix ) {
    const n = matrix.length;
    const m = matrix.map( ( row , i ) => row.slice().concat( Array.from( { length: n } , ( _ , j ) => ( i === j ? 1 : 0 ) ) ) );
    for ( let col = 0; col < n; col += 1 ) {
      let pivot = col;
      for ( let row = col + 1; row < n; row += 1 ) if ( Math.abs( m[ row ][ col ] ) > Math.abs( m[ pivot ][ col ] ) ) pivot = row;
      if ( Math.abs( m[ pivot ][ col ] ) < 1e-12 ) return null;
      [ m[ col ] , m[ pivot ] ] = [ m[ pivot ] , m[ col ] ];
      const lead = m[ col ][ col ];
      for ( let k = 0; k < 2 * n; k += 1 ) m[ col ][ k ] /= lead;
      for ( let other = 0; other < n; other += 1 ) {
        const factor = m[ other ][ col ];
        if ( other === col || factor === 0 ) continue;
        for ( let k = 0; k < 2 * n; k += 1 ) m[ other ][ k ] -= factor * m[ col ][ k ];
      }
    }
    return m.map( ( row ) => row.slice( n ) );
  },

  correlation( a , b ) {
    const n = Math.min( a.length , b.length );
    if ( !n ) return 0;
    let ma = 0;
    let mb = 0;
    for ( let i = 0; i < n; i += 1 ) { ma += a[ i ]; mb += b[ i ]; }
    ma /= n;
    mb /= n;
    let num = 0;
    let da = 0;
    let db = 0;
    for ( let i = 0; i < n; i += 1 ) {
      const x = a[ i ] - ma;
      const y = b[ i ] - mb;
      num += x * y;
      da += x * x;
      db += y * y;
    }
    return da > 0 && db > 0 ? num / Math.sqrt( da * db ) : 0;
  },

  contrastEfficiency( inverse , c ) {
    let total = 0;
    for ( let i = 0; i < c.length; i += 1 ) {
      if ( !c[ i ] ) continue;
      for ( let j = 0; j < c.length; j += 1 ) total += c[ i ] * inverse[ i ][ j ] * c[ j ];
    }
    return total > 0 ? 1 / total : 0;
  },

  // 0.0001234 -> "1.23e-4", 12.345 -> "12.3": efficiencies span decades.
  format( x ) {
    if ( x == null || !Number.isFinite( x ) ) return "–";
    if ( x === 0 ) return "0";
    const a = Math.abs( x );
    if ( a >= 1000 || a < 0.01 ) return x.toExponential( 2 );
    return x.toPrecision( 3 );
  },
};
