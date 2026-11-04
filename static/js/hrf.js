// The haemodynamic response every graph models: an SPM-style double gamma,
// a peak minus a smaller, later undershoot. p is a document's hrf block
// (Schema.HRF_DEFAULTS has the canonical values). Ported from the old
// planner's efficiency.js, so a design reads the same numbers it always did.
//
// A phase's predicted BOLD is its boxcar convolved with the HRF. That is
// computed analytically, as a difference of the HRF's running integral,
// which is tabulated once per set of parameters and scaled so that a long
// boxcar settles near 1 per second of HRF peak.
const Hrf = {
  DT: 0.05,
  tables: new Map(),

  logGamma( x ) {
    const cof = [ 76.18009172947146 , -86.50532032941677 , 24.01409824083091 , -1.231739572450155 , 0.1208650973866179e-2 , -0.5395239384953e-5 ];
    let y = x;
    let tmp = x + 5.5;
    tmp -= ( x + 0.5 ) * Math.log( tmp );
    let ser = 1.000000000190015;
    for ( let j = 0; j < 6; j += 1 ) {
      y += 1;
      ser += cof[ j ] / y;
    }
    return -tmp + Math.log( ( 2.5066282746310005 * ser ) / x );
  },

  gammaPdf( t , shape , scale ) {
    if ( t <= 0 ) return 0;
    return Math.exp( ( shape - 1 ) * Math.log( t ) - t / scale - this.logGamma( shape ) - shape * Math.log( scale ) );
  },

  // The response to an instant event, t seconds after it.
  shape( t , p ) {
    return this.gammaPdf( t , p.peak_delay / p.peak_dispersion , p.peak_dispersion )
      - this.gammaPdf( t , p.undershoot_delay / p.undershoot_dispersion , p.undershoot_dispersion ) / p.undershoot_ratio;
  },

  // Per parameter set: the running integral, plus caches for the
  // per-duration answers below. Only a handful of sets are ever live.
  table( p ) {
    const key = [ p.peak_delay , p.peak_dispersion , p.undershoot_delay , p.undershoot_dispersion , p.undershoot_ratio , p.span ].join( "|" );
    let entry = this.tables.get( key );
    if ( entry ) return entry;
    const steps = Math.round( p.span / this.DT ) + 1;
    const values = new Float64Array( steps );
    let peak = 0;
    for ( let i = 0; i < steps; i += 1 ) {
      values[ i ] = this.shape( i * this.DT , p );
      if ( values[ i ] > peak ) peak = values[ i ];
    }
    peak = peak || 1;
    const integral = new Float64Array( steps );
    let running = 0;
    for ( let k = 1; k < steps; k += 1 ) {
      running += ( ( values[ k ] + values[ k - 1 ] ) / 2 ) * this.DT;
      integral[ k ] = running / peak;
    }
    entry = { integral: integral , span: p.span , peaks: new Map() , decays: new Map() };
    if ( this.tables.size > 8 ) this.tables.clear();
    this.tables.set( key , entry );
    return entry;
  },

  integralAt( t , table ) {
    if ( t <= 0 ) return 0;
    const last = table.integral.length - 1;
    if ( t >= table.span ) return table.integral[ last ];
    const position = t / this.DT;
    const lower = Math.floor( position );
    const frac = position - lower;
    return table.integral[ lower ] * ( 1 - frac ) + table.integral[ Math.min( last , lower + 1 ) ] * frac;
  },

  // Predicted response at time t to a boxcar from onset lasting dur.
  boxcar( t , onset , dur , p ) {
    const table = this.table( p );
    return this.integralAt( t - onset , table ) - this.integralAt( t - onset - dur , table );
  },

  // The highest point an isolated event of this duration reaches.
  peak( dur , p ) {
    const table = this.table( p );
    const key = Math.round( dur * 100 );
    if ( table.peaks.has( key ) ) return table.peaks.get( key );
    let best = 0;
    for ( let t = 0; t <= p.peak_delay * 4; t += 0.1 ) best = Math.max( best , this.boxcar( t , 0 , dur , p ) );
    table.peaks.set( key , best || 1 );
    return best || 1;
  },

  // Seconds after onset until the response stays within tol (a fraction)
  // of its own peak for good, undershoot included.
  decayTime( dur , tol , p ) {
    const table = this.table( p );
    const key = Math.round( dur * 100 ) + ":" + Math.round( tol * 1e6 );
    if ( table.decays.has( key ) ) return table.decays.get( key );
    const limit = Math.max( 1e-9 , tol ) * this.peak( dur , p );
    let last = 0;
    for ( let t = 0; t <= p.span + dur; t += 0.1 ) {
      if ( Math.abs( this.boxcar( t , 0 , dur , p ) ) > limit ) last = t;
    }
    const value = Math.round( ( last + 0.1 ) * 10 ) / 10;
    table.decays.set( key , value );
    return value;
  },

  // What is left of an event's response, as a fraction of its peak, a given
  // time after its onset.
  residualAt( dur , elapsed , p ) {
    return Math.abs( this.boxcar( elapsed , 0 , dur , p ) ) / this.peak( dur , p );
  },

  // Where the curve peaks and bottoms out, for the plot's markers.
  landmarks( p ) {
    let peak = { t: 0 , v: -Infinity };
    let trough = { t: 0 , v: Infinity };
    for ( let t = 0; t <= p.span; t += 0.05 ) {
      const v = this.shape( t , p );
      if ( v > peak.v ) peak = { t: t , v: v };
      if ( t > peak.t && v < trough.v ) trough = { t: t , v: v };
    }
    return { peak: peak , trough: trough };
  },
};
