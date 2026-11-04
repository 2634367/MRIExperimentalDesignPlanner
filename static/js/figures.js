// Figures of a design for papers and slides: a trial, a run (zooming from
// the run to one block to one trial), a session. Each is a plain <svg>
// built from the document and Timing alone, drawn in the light palette for
// export or the page's palette on screen (Charts.palette), at the width
// given (the export's WIDTH by default). Everything is to scale at mean
// durations; jittered parts are hatched.
const Figures = {
  WIDTH: 820,
  MIN_WIDTH: 560,

  hatch( svg , pal ) {
    const defs = Charts.node( "defs" , {} , svg );
    const id = "hatch" + Math.random().toString( 36 ).slice( 2 , 8 );
    const pattern = Charts.node( "pattern" , { id: id , width: 6 , height: 6 , patternUnits: "userSpaceOnUse" , patternTransform: "rotate(45)" } , defs );
    Charts.node( "line" , { x1: 0 , y1: 0 , x2: 0 , y2: 6 , stroke: pal.background , "stroke-width": 2 , "stroke-opacity": 0.45 } , pattern );
    return "url(#" + id + ")";
  },

  // A row of parts to scale between x and x + w. Labels go inside a part
  // only when they fit.
  strip( svg , pal , hatch , x , y , w , h , parts ) {
    const total = parts.reduce( ( s , p ) => s + p.seconds , 0 ) || 1;
    let cursor = x;
    const placed = [];
    parts.forEach( ( p ) => {
      const pw = ( p.seconds / total ) * w;
      const fill = p.color || pal.axis;
      const rect = Charts.node( "rect" , { x: cursor , y: y , width: Math.max( 0.5 , pw - 1 ) , height: h , rx: 2 , fill: fill , "fill-opacity": p.muted ? 0.35 : 0.9 } , svg );
      Charts.node( "title" , {} , rect ).textContent = p.label + ": " + Timing.clock( p.seconds );
      if ( p.hatched ) Charts.node( "rect" , { x: cursor , y: y , width: Math.max( 0.5 , pw - 1 ) , height: h , rx: 2 , fill: hatch } , svg );
      const label = p.short || p.label;
      if ( label && pw > label.length * 6.4 + 8 ) {
        Charts.text( svg , cursor + pw / 2 , y + h / 2 + ( p.sub && h >= 30 ? -2 : 4 ) , label , { "text-anchor": "middle" , fill: p.muted ? pal.text : "#ffffff" , "font-size": 11 , "font-weight": 600 } );
        if ( p.sub && h >= 30 && pw > p.sub.length * 5.6 + 8 ) Charts.text( svg , cursor + pw / 2 , y + h / 2 + 12 , p.sub , { "text-anchor": "middle" , fill: p.muted ? pal.muted : "#ffffff" , "font-size": 9.5 } );
      }
      placed.push( { x0: cursor , x1: cursor + pw , part: p } );
      cursor += pw;
    } );
    return placed;
  },

  ruler( svg , pal , x , y , w , total , label ) {
    Charts.node( "line" , { x1: x , x2: x + w , y1: y , y2: y , stroke: pal.axis } , svg );
    const step = Charts.niceStep( total , Math.max( 3 , Math.round( w / 90 ) ) );
    for ( let t = 0; t <= total + 1e-9; t += step ) {
      const px = x + ( t / total ) * w;
      Charts.node( "line" , { x1: px , x2: px , y1: y , y2: y + 4 , stroke: pal.axis } , svg );
      Charts.text( svg , px , y + 15 , total >= 120 ? Timing.clock( t ) : Charts.number( t ) , { "text-anchor": "middle" , fill: pal.muted , "font-size": 10 } );
    }
    if ( label ) Charts.text( svg , x + w , y + 28 , label , { "text-anchor": "end" , fill: pal.muted , "font-size": 10 } );
  },

  title( svg , pal , text , sub ) {
    Charts.text( svg , 16 , 22 , text , { "font-size": 14 , "font-weight": 600 , fill: pal.text } );
    if ( sub ) Charts.text( svg , 16 , 38 , sub , { "font-size": 11 , fill: pal.muted } );
  },

  // Zoom connector: the span x0..x1 of the row above opens out to the full
  // width of the row below.
  connector( svg , pal , x0 , x1 , yTop , left , right , yBottom ) {
    Charts.node( "polygon" , {
      points: [ x0 + "," + yTop , x1 + "," + yTop , right + "," + yBottom , left + "," + yBottom ].join( " " ) ,
      fill: pal.band , "fill-opacity": 0.08 , stroke: pal.band , "stroke-opacity": 0.35 , "stroke-dasharray": "3 3",
    } , svg );
  },

  phaseParts( doc , tt , tr ) {
    return tt.phases.map( ( phase ) => {
      const span = Timing.span( phase.duration , tr || doc.scanner.tr );
      return {
        label: phase.name || "–" , seconds: Math.max( span.mean , 0.05 ) , color: tt.color ,
        hatched: phase.duration.kind !== "fixed" , sub: Timing.describe( span ).split( " · " )[ 0 ] , phase: phase , span: span ,
      };
    } );
  },

  // -- a trial ---------------------------------------------------------------

  trial( doc , tt , light , size ) {
    const pal = Charts.palette( light );
    const w = Math.max( this.MIN_WIDTH , Math.round( size || this.WIDTH ) );
    const h = 170;
    const svg = Charts.svg( w , h , pal );
    const hatch = this.hatch( svg , pal );
    const span = Timing.trial( doc , tt );
    this.title( svg , pal , tt.name || I18n.get( "trials.unnamed" ) , I18n.get( "figures.trial_sub" ).replace( "{span}" , Timing.describe( span ) ) );
    const parts = this.phaseParts( doc , tt );
    const placed = this.strip( svg , pal , hatch , 16 , 56 , w - 32 , 44 , parts );
    // Onsets at mean durations, and which phases are modelled.
    placed.forEach( ( p ) => {
      Charts.node( "line" , { x1: p.x0 , x2: p.x0 , y1: 50 , y2: 104 , stroke: pal.axis , "stroke-width": 0.8 } , svg );
      if ( p.part.phase.modelled ) Charts.text( svg , p.x0 + 3 , 116 , "◆ " + I18n.get( "figures.modelled" ) , { fill: pal.series[ 0 ] , "font-size": 9.5 } );
    } );
    this.ruler( svg , pal , 16 , 132 , w - 32 , parts.reduce( ( s , p ) => s + p.seconds , 0 ) , I18n.get( "figures.seconds_mean" ) );
    return svg;
  },

  // -- a run ---------------------------------------------------------------

  runParts( doc , run , info , pal ) {
    const parts = [];
    const add = ( p ) => { if ( p.seconds > 0 ) parts.push( p ); };
    add( { label: I18n.get( "runs.dummies" ) , short: I18n.get( "figures.dummies_short" ) , seconds: info.dummy * info.tr , muted: true , color: pal.axis } );
    add( { label: I18n.get( "runs.lead_in" ) , seconds: run.lead_in.seconds , muted: true , color: pal.axis } );
    let left = run.blocks.reduce( ( n , b ) => n + b.repeat , 0 );
    run.blocks.forEach( ( block , index ) => {
      const blockInfo = info.blocks.find( ( b ) => b.block === block );
      const first = block.mix.length ? Timing.trialTypeById( doc , block.mix[ 0 ].trial_type ) : null;
      for ( let r = 0; r < block.repeat; r += 1 ) {
        add( { label: block.name || I18n.get( "runs.block" ) + " " + ( index + 1 ) , seconds: blockInfo.one.mean , color: first ? first.color : pal.series[ 0 ] , block: block , first: r === 0 && index === 0 } );
        left -= 1;
        if ( left > 0 && block.rest_after.seconds > 0 ) add( { label: I18n.get( "runs.rest_short" ) , seconds: block.rest_after.seconds , muted: true , color: pal.axis } );
      }
    } );
    add( { label: I18n.get( "runs.lead_out" ) , seconds: run.lead_out.seconds , muted: true , color: pal.axis } );
    return parts;
  },

  run( doc , run , light , size ) {
    const pal = Charts.palette( light );
    const w = Math.max( this.MIN_WIDTH , Math.round( size || this.WIDTH ) );
    const h = 330;
    const svg = Charts.svg( w , h , pal );
    const hatch = this.hatch( svg , pal );
    const info = Timing.run( doc , run );
    this.title( svg , pal , run.name || I18n.get( "runs.unnamed" ) , I18n.get( "figures.run_sub" )
      .replace( "{trials}" , info.trials ).replace( "{length}" , Timing.clock( info.total.mean ) ).replace( "{tr}" , info.tr ).replace( "{volumes}" , info.volumes.max ) );
    const x = 90;
    const width = w - x - 16;
    const label = ( y , text ) => Charts.text( svg , 16 , y , text , { fill: pal.muted , "font-size": 11 , "font-weight": 600 } );

    label( 84 , I18n.get( "figures.row_run" ) );
    const runParts = this.runParts( doc , run , info , pal );
    const placedRun = this.strip( svg , pal , hatch , x , 62 , width , 36 , runParts );
    this.ruler( svg , pal , x , 102 , width , runParts.reduce( ( s , p ) => s + p.seconds , 0 ) );

    // One repeat of the first block, trial by trial, in the order the mix
    // lists them (the real order is drawn per run).
    const firstBlock = placedRun.find( ( p ) => p.part.first );
    if ( !firstBlock ) return svg;
    const block = firstBlock.part.block;
    const trialParts = [];
    block.mix.forEach( ( entry ) => {
      const tt = Timing.trialTypeById( doc , entry.trial_type );
      if ( !tt ) return;
      for ( let k = 0; k < entry.count; k += 1 ) trialParts.push( { label: "" , seconds: Timing.trial( doc , tt , info.tr ).mean , color: tt.color , tt: tt } );
    } );
    label( 174 , I18n.get( "figures.row_block" ) );
    this.connector( svg , pal , firstBlock.x0 , firstBlock.x1 , 98 , x , x + width , 154 );
    const placedBlock = this.strip( svg , pal , hatch , x , 154 , width , 30 , trialParts );
    if ( !placedBlock.length ) return svg;

    const tt = placedBlock[ 0 ].part.tt;
    label( 264 , I18n.get( "figures.row_trial" ) );
    this.connector( svg , pal , placedBlock[ 0 ].x0 , placedBlock[ 0 ].x1 , 184 , x , x + width , 240 );
    const phases = this.phaseParts( doc , tt , info.tr );
    this.strip( svg , pal , hatch , x , 240 , width , 40 , phases );
    this.ruler( svg , pal , x , 284 , width , phases.reduce( ( s , p ) => s + p.seconds , 0 ) , I18n.get( "figures.seconds_mean" ) );
    // A key to the trial types in the block.
    let kx = x;
    const seen = new Set();
    trialParts.forEach( ( p ) => {
      if ( seen.has( p.tt.id ) ) return;
      seen.add( p.tt.id );
      Charts.node( "rect" , { x: kx , y: 196 , width: 10 , height: 10 , rx: 2 , fill: p.tt.color } , svg );
      const name = p.tt.name || I18n.get( "trials.unnamed" );
      Charts.text( svg , kx + 14 , 205 , name , { fill: pal.muted , "font-size": 10 } );
      kx += 26 + name.length * 5.8;
    } );
    return svg;
  },

  // -- a session -------------------------------------------------------------

  session( doc , session , light , size ) {
    const pal = Charts.palette( light );
    const w = Math.max( this.MIN_WIDTH , Math.round( size || this.WIDTH ) );
    const h = 200;
    const svg = Charts.svg( w , h , pal );
    const hatch = this.hatch( svg , pal );
    const info = Timing.session( doc , session );
    this.title( svg , pal , session.name || I18n.get( "sessions.unnamed" ) , I18n.get( "figures.session_sub" )
      .replace( "{length}" , Timing.clock( info.seconds.mean ) ).replace( "{runs}" , info.runs ).replace( "{trials}" , info.trials ) );
    const runColor = ( run ) => pal.series[ Math.max( 0 , doc.runs.indexOf( run ) ) % pal.series.length ];
    const parts = Timing.items( doc , session ).map( ( item ) => {
      if ( item.kind === "run" ) return { label: item.run ? item.run.name || I18n.get( "runs.unnamed" ) : "?" , seconds: item.seconds.mean , color: item.run ? runColor( item.run ) : pal.axis , sub: Timing.clock( item.seconds.mean ) };
      if ( item.kind === "scan" ) return { label: item.step.name || I18n.get( "sessions.kind_scan" ) , seconds: item.seconds.mean , color: pal.muted , sub: Timing.clock( item.seconds.mean ) };
      return { label: item.auto ? I18n.get( "sessions.kind_break" ) : item.step.name || I18n.get( "sessions.kind_break" ) , seconds: item.seconds.mean , muted: true , color: pal.axis , hatched: item.auto , sub: Timing.clock( item.seconds.mean ) };
    } ).filter( ( p ) => p.seconds > 0 );
    const x = 16;
    const width = w - 32;
    this.strip( svg , pal , hatch , x , 58 , width , 48 , parts );
    const total = parts.reduce( ( s , p ) => s + p.seconds , 0 ) || 1;
    // The spread jitter gives the whole session.
    if ( info.seconds.max > info.seconds.min + 1 ) {
      const X = ( s ) => x + ( s / Math.max( total , info.seconds.max ) ) * width;
      Charts.node( "line" , { x1: X( info.seconds.min ) , x2: X( info.seconds.max ) , y1: 118 , y2: 118 , stroke: pal.text } , svg );
      [ info.seconds.min , info.seconds.max ].forEach( ( s ) => Charts.node( "line" , { x1: X( s ) , x2: X( s ) , y1: 113 , y2: 123 , stroke: pal.text } , svg ) );
      Charts.node( "circle" , { cx: X( info.seconds.mean ) , cy: 118 , r: 3.5 , fill: pal.text } , svg );
      Charts.text( svg , X( info.seconds.max ) + 6 , 122 , I18n.get( "figures.session_range" ).replace( "{min}" , Timing.clock( info.seconds.min ) ).replace( "{max}" , Timing.clock( info.seconds.max ) ) , { fill: pal.muted , "font-size": 10 } );
    }
    this.ruler( svg , pal , x , 140 , width , total , I18n.get( "figures.clock" ) );
    return svg;
  },

  // Every figure of a document, for the report: [{ name, make(light, width) }].
  all( doc ) {
    const out = [];
    doc.trial_types.forEach( ( tt ) => out.push( { name: "trial-" + ( tt.name || tt.id ) , make: ( light , width ) => this.trial( doc , tt , light , width ) } ) );
    doc.runs.forEach( ( run ) => out.push( { name: "run-" + ( run.name || run.id ) , make: ( light , width ) => this.run( doc , run , light , width ) } ) );
    doc.sessions.forEach( ( s ) => out.push( { name: "session-" + ( s.name || s.id ) , make: ( light , width ) => this.session( doc , s , light , width ) } ) );
    return out;
  },
};
