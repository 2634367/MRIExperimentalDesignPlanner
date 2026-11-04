// The shape of an experiment document, and the one place its defaults live.
//
// An experiment is one JSON document. Everything in it refers to everything
// else by id, never by name or by position, so renaming a trial type or
// reordering a list cannot break what uses it:
//
//   scanner      tr, trigger_key, dummy_volumes
//   display      background, text_color, font, text_height, aspect
//   keys         quit / advance key names (PsychoPy's names)
//   budget       hours_available, participants
//   hrf          the double-gamma response every graph models (static/js/hrf.js)
//   media[]      pictures: { id (sha256), name, ext, w, h, ... }
//   lists[]      prompt lists: { columns[{ key, label, type }], items[{ id, values{} }] }
//   trial_types[] { list, filter{ column, values[] }, order, balance_by, no_repeat,
//                  phases[{ duration, layers[], response, modelled }] }
//   runs[]       { tr, dummy_volumes (0 / -1: the scanner's), card, instructions, lead_in, lead_out,
//                  blocks[{ mix[{ trial_type, count }], repeat, order, rest_after }] }
//   sessions[]   { count, auto_break_minutes, steps[{ kind: run|scan|break, run, name, minutes, card }] }
//
// A phase that is "modelled" is one regressor in the HRF analysis (the
// trial's name plus the phase's), so each trial type is its own condition.
// auto_break_minutes puts a break between two run steps that sit directly
// next to each other; 0 means none.
//
// card (on a run or a scan step) is a scanner card from the shared library
// (static/js/scanners.js): its id plus a snapshot { label, tr, seconds } of
// what was taken from it, copied into tr / minutes too, so nothing else needs
// the library to read the document.
//
// A layer's text and picture may be a literal or "{column}", filled from the
// trial's prompt item when the run is compiled (static/js/compile.js). A
// layer whose value comes out empty is simply not drawn, which is how one
// trial type serves items with and without a picture.
//
// A trial type's filter narrows its list to the items whose column holds one
// of values (an empty column means every item), so several trial types can
// draw different parts of one list and still never repeat an item between
// them.
//
// normalise() fills in anything missing, so every other file can read any
// field without checking it exists; migrate() is where a future format
// change upgrades an older document.
const Schema = {
  FORMAT_VERSION: 2,
  DURATION_KINDS: [ "fixed" , "geometric" , "uniform" , "exponential" ],
  // How a phase is jittered unless it says otherwise: the truncated geometric
  // (static/js/timing.js), which gives the participant nothing to anticipate.
  DEFAULT_JITTER: "geometric",
  LAYER_KINDS: [ "text" , "image" , "shape" ],
  SHAPES: [ "circle" , "square" , "triangle" , "diamond" , "cross" , "polygon" ],
  COLUMN_TYPES: [ "text" , "image" , "number" ],
  STEP_KINDS: [ "run" , "scan" , "break" ],
  // The canonical (SPM-style) double gamma, and the range each slider allows.
  HRF_DEFAULTS: { peak_delay: 6 , peak_dispersion: 1 , undershoot_delay: 16 , undershoot_dispersion: 1 , undershoot_ratio: 6 , span: 32 },
  HRF_RANGES: {
    peak_delay: [ 2 , 14 , 0.1 ] , peak_dispersion: [ 0.3 , 3 , 0.05 ] ,
    undershoot_delay: [ 6 , 34 , 0.5 ] , undershoot_dispersion: [ 0.3 , 3 , 0.05 ] ,
    undershoot_ratio: [ 1 , 24 , 0.5 ] , span: [ 12 , 120 , 1 ],
  },

  uid( prefix ) {
    const bytes = new Uint8Array( 6 );
    crypto.getRandomValues( bytes );
    return ( prefix || "x" ) + "_" + Array.from( bytes , ( b ) => b.toString( 36 ).padStart( 2 , "0" ) ).join( "" ).slice( 0 , 9 );
  },

  // A column key from its label: what {key} templates are written with.
  columnKey( label , taken ) {
    let base = String( label || "" ).toLowerCase().replace( /[^a-z0-9]+/g , "_" ).replace( /^_+|_+$/g , "" ) || "column";
    if ( /^[0-9]/.test( base ) ) base = "c_" + base;
    let key = base;
    let n = 2;
    while ( ( taken || [] ).includes( key ) ) key = base + "_" + n++;
    return key;
  },

  blank( name ) {
    return this.normalise( { name: name || "" , format_version: this.FORMAT_VERSION } );
  },

  // -- factories: a new thing of each kind, with its defaults -------------

  textLayer( text , height ) {
    return { id: this.uid( "l" ) , kind: "text" , text: text == null ? "" : text , pos: [ 0 , 0 ] , height: height || 0.06 , color: "" , wrap: 1.2 , bold: false };
  },
  imageLayer( media ) {
    return { id: this.uid( "l" ) , kind: "image" , media: media || "" , pos: [ 0 , 0 ] , height: 0.4 , fit: false };
  },
  shapeLayer( shape ) {
    return { id: this.uid( "l" ) , kind: "shape" , shape: shape || "circle" , sides: 5 , pos: [ 0 , 0 ] , size: 0.1 , color: "" , fill: true , ori: 0 , line_width: 3 };
  },
  fixation() {
    return [ this.textLayer( "+" , 0.08 ) ];
  },
  column( label , type , taken ) {
    return { key: this.columnKey( label , taken ) , label: label || "" , type: type || "text" };
  },
  list( name ) {
    return {
      id: this.uid( "list" ) , name: name || "" ,
      columns: [ this.column( "Text" , "text" ) , this.column( "Image" , "image" , [ "text" ] ) ],
      items: [],
    };
  },
  item( values ) {
    return { id: this.uid( "i" ) , values: Object.assign( {} , values || {} ) };
  },
  duration( kind , a , b ) {
    if ( kind === "fixed" || kind === undefined ) return { kind: "fixed" , value: a == null ? 1 : a , min: 2 , max: 6 , p: 0.5 , scale: 0.5 , snap_to_tr: false };
    return { kind: kind , value: 1 , min: a == null ? 2 : a , max: b == null ? 6 : b , p: 0.5 , scale: 0.5 , snap_to_tr: false };
  },
  // A jittered duration, min a to max b, of the default kind.
  jittered( a , b ) {
    return this.duration( this.DEFAULT_JITTER , a , b );
  },
  phase( name , duration , layers ) {
    return { id: this.uid( "ph" ) , name: name || "" , duration: duration || this.duration( "fixed" , 1 ) , layers: layers || [] , response: { keys: [] , ends_phase: false } , modelled: false };
  },
  trialType( name ) {
    return {
      id: this.uid( "tt" ) , name: name || "" , color: "#4c78a8" , notes: "" ,
      list: "" , filter: { column: "" , values: [] } , order: "shuffle" , balance_by: "" , no_repeat: "session" ,
      phases: [
        this.phase( "Fixation" , this.jittered( 2 , 6 ) , this.fixation() ),
        this.phase( "Prompt" , this.duration( "fixed" , 4 ) , [ this.textLayer( "{text}" ) ] ),
      ],
    };
  },
  screen( seconds , layers ) {
    return { seconds: seconds == null ? 10 : seconds , layers: layers || this.fixation() };
  },
  block( trialType ) {
    return {
      id: this.uid( "b" ) , name: "" , repeat: 1 , order: "shuffle" ,
      mix: trialType ? [ { trial_type: trialType , count: 10 } ] : [] ,
      rest_after: this.screen( 0 ),
    };
  },
  run( name , trialType ) {
    return {
      id: this.uid( "run" ) , name: name || "" , notes: "" , tr: 0 , dummy_volumes: -1 , card: null ,
      instructions: { enabled: true , layers: [ this.textLayer( "" , 0.05 ) ] },
      lead_in: this.screen( 10 ) , lead_out: this.screen( 10 ) ,
      blocks: [ this.block( trialType ) ],
    };
  },
  step( kind , run ) {
    return { id: this.uid( "st" ) , kind: kind || "run" , run: run || "" , name: "" , minutes: 5 , card: null };
  },
  session( name , run ) {
    return {
      id: this.uid( "ses" ) , name: name || "" , count: 1 , notes: "" , auto_break_minutes: 0 ,
      steps: [ Object.assign( this.step( "break" ) , { minutes: 10 } ) , ...( run ? [ this.step( "run" , run ) ] : [] ) ],
    };
  },

  // -- normalise: every field present, every value the right type ---------

  normalise( input ) {
    const doc = this.migrate( input && typeof input === "object" ? input : {} );
    const num = ( value , fallback , low , high ) => {
      const n = Number( value );
      if ( !Number.isFinite( n ) ) return fallback;
      return Math.min( high == null ? Infinity : high , Math.max( low == null ? -Infinity : low , n ) );
    };
    const str = ( value , fallback ) => ( typeof value === "string" ? value : fallback == null ? "" : fallback );
    const arr = ( value ) => ( Array.isArray( value ) ? value : [] );
    const id = ( value , prefix ) => ( typeof value === "string" && value ? value : this.uid( prefix ) );
    const keys = ( value , fallback ) => {
      const list = Array.isArray( value ) ? value : typeof value === "string" ? value.split( /[\s,]+/ ) : fallback;
      return list.map( ( k ) => String( k ).trim() ).filter( ( k ) => /^[A-Za-z0-9_]{1,20}$/.test( k ) );
    };
    const pos = ( value ) => ( Array.isArray( value ) && value.length === 2 ? [ num( value[ 0 ] , 0 , -10 , 10 ) , num( value[ 1 ] , 0 , -10 , 10 ) ] : [ 0 , 0 ] );

    const layer = ( raw ) => {
      const kind = this.LAYER_KINDS.includes( raw && raw.kind ) ? raw.kind : "text";
      const base = kind === "image" ? this.imageLayer() : kind === "shape" ? this.shapeLayer() : this.textLayer();
      const out = Object.assign( base , raw || {} , { id: id( raw && raw.id , "l" ) , kind: kind , pos: pos( raw && raw.pos ) } );
      if ( kind === "text" ) {
        out.text = str( out.text );
        out.height = num( out.height , 0.06 , 0.001 , 2 );
        out.wrap = num( out.wrap , 1.2 , 0.01 , 10 );
        out.bold = Boolean( out.bold );
        out.color = str( out.color );
      } else if ( kind === "image" ) {
        out.media = str( out.media );
        out.height = num( out.height , 0.4 , 0.001 , 4 );
        out.fit = Boolean( out.fit );
      } else {
        out.shape = this.SHAPES.includes( out.shape ) ? out.shape : "circle";
        out.sides = Math.round( num( out.sides , 5 , 3 , 64 ) );
        out.size = num( out.size , 0.1 , 0.001 , 4 );
        out.fill = out.fill !== false;
        out.ori = num( out.ori , 0 , -360 , 360 );
        out.line_width = num( out.line_width , 3 , 0.1 , 50 );
        out.color = str( out.color );
      }
      return out;
    };
    const layers = ( value ) => arr( value ).slice( 0 , 32 ).map( layer );
    const duration = ( raw ) => {
      const d = Object.assign( this.duration( "fixed" ) , raw || {} );
      d.kind = this.DURATION_KINDS.includes( d.kind ) ? d.kind : "fixed";
      d.value = num( d.value , 1 , 0 , 3600 );
      d.min = num( d.min , 2 , 0 , 3600 );
      d.max = Math.max( d.min , num( d.max , 6 , 0 , 3600 ) );
      d.p = num( d.p , 0.5 , 0.02 , 0.98 );
      d.scale = num( d.scale , 0.5 , 0.05 , 5 );
      d.snap_to_tr = Boolean( d.snap_to_tr );
      return d;
    };
    // A scanner card a run or scan step uses: its id in the shared library,
    // and a snapshot of what was taken from it (see Scanners.ref).
    const cardRef = ( raw ) => ( raw && typeof raw === "object" && typeof raw.id === "string" && raw.id ? {
      id: raw.id.slice( 0 , 120 ) , label: str( raw.label ).slice( 0 , 200 ) ,
      tr: num( raw.tr , 0 , 0 , 30 ) , seconds: num( raw.seconds , 0 , 0 , 86400 ),
    } : null );
    const screen = ( raw , seconds ) => ( {
      seconds: num( raw && raw.seconds , seconds , 0 , 3600 ),
      layers: raw && Array.isArray( raw.layers ) ? layers( raw.layers ) : this.fixation(),
    } );

    const out = {
      format_version: this.FORMAT_VERSION,
      name: str( doc.name ),
      notes: str( doc.notes ),
      scanner: {
        tr: num( doc.scanner && doc.scanner.tr , 2 , 0.05 , 30 ),
        trigger_key: keys( doc.scanner && doc.scanner.trigger_key , [ "5" ] )[ 0 ] || "5",
        dummy_volumes: Math.round( num( doc.scanner && doc.scanner.dummy_volumes , 4 , 0 , 1000 ) ),
      },
      display: {
        background: this.color( doc.display && doc.display.background , "#000000" ),
        text_color: this.color( doc.display && doc.display.text_color , "#ffffff" ),
        font: str( doc.display && doc.display.font , "Arial" ) || "Arial",
        aspect: num( doc.display && doc.display.aspect , 1.6 , 0.5 , 4 ),
      },
      keys: {
        quit: keys( doc.keys && doc.keys.quit , [ "escape" ] ),
        advance: keys( doc.keys && doc.keys.advance , [ "space" ] ),
      },
      hrf: Object.fromEntries( Object.entries( this.HRF_DEFAULTS ).map( ( [ k , v ] ) =>
        [ k , num( doc.hrf && doc.hrf[ k ] , v , this.HRF_RANGES[ k ][ 0 ] , this.HRF_RANGES[ k ][ 1 ] ) ] ) ),
      budget: {
        hours_available: num( doc.budget && doc.budget.hours_available , 10 , 0 , 100000 ),
        participants: Math.round( num( doc.budget && doc.budget.participants , 1 , 0 , 100000 ) ),
      },
      media: arr( doc.media ).filter( ( m ) => m && /^[0-9a-f]{64}$/.test( m.id ) ).map( ( m ) => ( {
        id: m.id , name: str( m.name , m.id.slice( 0 , 10 ) ) , ext: str( m.ext , "png" ) , mime: str( m.mime ) ,
        w: Math.round( num( m.w , 1 , 1 ) ) , h: Math.round( num( m.h , 1 , 1 ) ) , size: num( m.size , 0 , 0 ) , source_url: str( m.source_url ),
      } ) ),
      lists: arr( doc.lists ).map( ( list ) => {
        const columns = [];
        arr( list && list.columns ).forEach( ( c ) => {
          const key = c && typeof c.key === "string" && /^[a-z_][a-z0-9_]*$/.test( c.key ) && !columns.some( ( x ) => x.key === c.key )
            ? c.key : this.columnKey( c && c.label , columns.map( ( x ) => x.key ) );
          columns.push( { key: key , label: str( c && c.label , key ) , type: this.COLUMN_TYPES.includes( c && c.type ) ? c.type : "text" } );
        } );
        return {
          id: id( list && list.id , "list" ) , name: str( list && list.name ) , notes: str( list && list.notes ) ,
          columns: columns,
          items: arr( list && list.items ).map( ( item ) => {
            const values = {};
            columns.forEach( ( c ) => {
              const v = item && item.values ? item.values[ c.key ] : undefined;
              values[ c.key ] = v == null ? "" : String( v );
            } );
            return { id: id( item && item.id , "i" ) , values: values };
          } ),
        };
      } ),
      trial_types: arr( doc.trial_types ).map( ( tt ) => ( {
        id: id( tt && tt.id , "tt" ) , name: str( tt && tt.name ) , notes: str( tt && tt.notes ) ,
        color: this.color( tt && tt.color , "#4c78a8" ) ,
        list: str( tt && tt.list ) ,
        filter: {
          column: tt && tt.filter && /^[a-z_][a-z0-9_]*$/.test( tt.filter.column ) ? tt.filter.column : "" ,
          values: arr( tt && tt.filter && tt.filter.values ).map( String ).filter( ( v , i , all ) => all.indexOf( v ) === i ) ,
        },
        order: [ "shuffle" , "sequential" ].includes( tt && tt.order ) ? tt.order : "shuffle" ,
        balance_by: str( tt && tt.balance_by ) ,
        no_repeat: [ "session" , "run" , "none" ].includes( tt && tt.no_repeat ) ? tt.no_repeat : "session" ,
        phases: arr( tt && tt.phases ).map( ( ph ) => ( {
          id: id( ph && ph.id , "ph" ) , name: str( ph && ph.name ) ,
          duration: duration( ph && ph.duration ) ,
          layers: layers( ph && ph.layers ) ,
          response: { keys: keys( ph && ph.response && ph.response.keys , [] ) , ends_phase: Boolean( ph && ph.response && ph.response.ends_phase ) },
          modelled: Boolean( ph && ph.modelled ),
        } ) ),
      } ) ),
      runs: arr( doc.runs ).map( ( run ) => ( {
        id: id( run && run.id , "run" ) , name: str( run && run.name ) , notes: str( run && run.notes ) ,
        tr: num( run && run.tr , 0 , 0 , 30 ) ,
        dummy_volumes: Math.round( num( run && run.dummy_volumes , -1 , -1 , 1000 ) ) ,
        card: cardRef( run && run.card ) ,
        instructions: {
          enabled: !( run && run.instructions && run.instructions.enabled === false ),
          layers: run && run.instructions && Array.isArray( run.instructions.layers ) ? layers( run.instructions.layers ) : [ this.textLayer( "" , 0.05 ) ],
        },
        lead_in: screen( run && run.lead_in , 10 ) ,
        lead_out: screen( run && run.lead_out , 10 ) ,
        blocks: arr( run && run.blocks ).map( ( block ) => ( {
          id: id( block && block.id , "b" ) , name: str( block && block.name ) ,
          repeat: Math.round( num( block && block.repeat , 1 , 1 , 1000 ) ) ,
          order: [ "shuffle" , "fixed" , "alternate" ].includes( block && block.order ) ? block.order : "shuffle" ,
          mix: arr( block && block.mix ).map( ( m ) => ( { trial_type: str( m && m.trial_type ) , count: Math.round( num( m && m.count , 1 , 0 , 10000 ) ) } ) ) ,
          rest_after: screen( block && block.rest_after , 0 ),
        } ) ),
      } ) ),
      sessions: arr( doc.sessions ).map( ( session ) => ( {
        id: id( session && session.id , "ses" ) , name: str( session && session.name ) , notes: str( session && session.notes ) ,
        count: Math.round( num( session && session.count , 1 , 0 , 1000 ) ) ,
        auto_break_minutes: num( session && session.auto_break_minutes , 0 , 0 , 240 ) ,
        steps: arr( session && session.steps ).map( ( step ) => ( {
          id: id( step && step.id , "st" ) ,
          kind: this.STEP_KINDS.includes( step && step.kind ) ? step.kind : "break" ,
          run: str( step && step.run ) , name: str( step && step.name ) ,
          minutes: num( step && step.minutes , 5 , 0 , 1440 ),
          card: step && step.kind === "scan" ? cardRef( step.card ) : null,
        } ) ),
      } ) ),
    };
    return out;
  },

  color( value , fallback ) {
    return typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test( value ) ? value.toLowerCase() : fallback;
  },

  // Upgrades from older format_versions go here, one step at a time, so a
  // document saved by any version of this app opens in every later one.
  // (Documents from the old planner are a different format altogether --
  // static/js/legacy.js converts those.)
  migrate( doc ) {
    const version = Number( doc.format_version ) || this.FORMAT_VERSION;
    if ( version > this.FORMAT_VERSION ) {
      throw new Error( I18n.get( "errors.newer_format" ) );
    }
    let out = doc;
    // 1 -> 2: geometric became the default jitter, so a uniform phase becomes
    // geometric -- unless its window is narrower than one TR, where a
    // geometric could never vary. Exponential was always a deliberate choice.
    if ( version < 2 ) {
      out = JSON.parse( JSON.stringify( out ) );
      const tr = Number( out.scanner && out.scanner.tr ) || 2;
      ( Array.isArray( out.trial_types ) ? out.trial_types : [] ).forEach( ( tt ) => ( tt && Array.isArray( tt.phases ) ? tt.phases : [] ).forEach( ( phase ) => {
        const d = phase && phase.duration;
        if ( d && d.kind === "uniform" && Number( d.max ) - Number( d.min ) >= tr - 1e-9 ) d.kind = this.DEFAULT_JITTER;
      } ) );
      out.format_version = 2;
    }
    return out;
  },

  // A small, complete design to start from: one prompt list, two trial
  // types that differ only in their cue, one run, one session.
  example( name ) {
    const list = this.list( I18n.get( "example.list_name" ) );
    list.columns = [ this.column( "Text" , "text" ) , this.column( "Image" , "image" , [ "text" ] ) , this.column( "Category" , "text" , [ "text" , "image" ] ) ];
    I18n.get( "example.items" ).split( "|" ).forEach( ( entry ) => {
      const parts = entry.split( ":" );
      list.items.push( this.item( { text: parts[ 0 ] , image: "" , category: parts[ 1 ] || "" } ) );
    } );
    const say = this.trialType( I18n.get( "example.trial_say" ) );
    say.list = list.id;
    say.balance_by = "category";
    // Twelve words, twelve trials a run: each word once per run.
    say.no_repeat = "run";
    say.phases = [
      this.phase( I18n.get( "example.phase_fixation" ) , this.jittered( 2 , 6 ) , this.fixation() ),
      this.phase( I18n.get( "example.phase_cue" ) , this.duration( "fixed" , 1 ) , [ Object.assign( this.shapeLayer( "circle" ) , { color: "#4caf50" } ) ] ),
      this.phase( I18n.get( "example.phase_prompt" ) , this.duration( "fixed" , 3 ) , [ this.textLayer( "{text}" , 0.08 ) , Object.assign( this.imageLayer( "{image}" ) , { pos: [ 0 , -0.22 ] , height: 0.3 } ) ] ),
      this.phase( I18n.get( "example.phase_iti" ) , this.duration( "geometric" , 2 , 8 ) , this.fixation() ),
    ];
    // The cue tells the two conditions apart, so that is what is modelled.
    say.phases[ 1 ].modelled = true;
    const read = JSON.parse( JSON.stringify( say ) );
    read.id = this.uid( "tt" );
    read.name = I18n.get( "example.trial_read" );
    read.color = "#e45756";
    read.phases[ 1 ].layers = [ Object.assign( this.shapeLayer( "square" ) , { color: "#e45756" } ) ];
    read.phases.forEach( ( phase ) => {
      phase.id = this.uid( "ph" );
      phase.layers.forEach( ( l ) => { l.id = this.uid( "l" ); } );
    } );
    const run = this.run( I18n.get( "example.run_name" ) );
    run.instructions.layers[ 0 ].text = I18n.get( "example.instructions" );
    run.blocks = [ Object.assign( this.block() , { mix: [ { trial_type: say.id , count: 6 } , { trial_type: read.id , count: 6 } ] } ) ];
    const session = this.session( I18n.get( "example.session_name" ) , run.id );
    session.steps = [
      Object.assign( this.step( "break" ) , { name: I18n.get( "example.step_setup" ) , minutes: 10 } ),
      Object.assign( this.step( "scan" ) , { name: I18n.get( "example.step_t1" ) , minutes: 6 } ),
      this.step( "run" , run.id ),
      this.step( "run" , run.id ),
    ];
    return this.normalise( {
      name: name || I18n.get( "example.name" ) ,
      budget: { hours_available: 20 , participants: 10 },
      scanner: { tr: 2 , trigger_key: "5" , dummy_volumes: 4 },
      lists: [ list ] , trial_types: [ say , read ] , runs: [ run ] , sessions: [ session ],
    } );
  },
};
