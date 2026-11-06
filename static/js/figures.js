// Figures of a design for papers and slides: the whole study, a trial, a run
// (zooming from the run to one block to one trial), a session. Each is a plain
// <svg> built from the document and Timing alone, drawn in the light palette
// for export or the page's palette on screen (Charts.palette), at the width
// given (the export's WIDTH by default). Everything is to scale at mean
// durations; jittered parts are hatched.
//
// A trial figure shows each phase's screen as the first item draws it. Its
// pictures are embedded, as small copies, so the figure stands alone wherever
// it is saved. Those copies load in the background: load() waits for them, and
// a figure drawn sooner shows a labelled box and is redrawn when they arrive.
const Figures = {
  WIDTH: 820,
  MIN_WIDTH: 560,
  THUMB_HEIGHT: 320,
  pictures: {},   // sha -> a small copy as a data URL, "" if it could not be read
  loading: null,

  // What the trial figures show: the first item's resolved layers, per phase.
  screens( doc , tt ) {
    const list = doc.lists.find( ( l ) => l.id === tt.list ) || null;
    const item = Compile.itemsFor( tt , list )[ 0 ] || null;
    return tt.phases.map( ( phase ) => Compile.resolveLayers( doc , phase.layers , item , list ) );
  },

  picturesNeeded( doc ) {
    const found = new Set();
    doc.trial_types.forEach( ( tt ) => this.screens( doc , tt ).forEach( ( layers ) => layers.forEach( ( layer ) => {
      if ( layer.kind === "image" ) found.add( layer.media );
    } ) ) );
    return Array.from( found );
  },

  async smallCopy( sha ) {
    try {
      const response = await fetch( Doc.mediaUrl( sha ) , { credentials: "same-origin" } );
      const bitmap = await createImageBitmap( await response.blob() );
      const k = Math.min( 1 , this.THUMB_HEIGHT / bitmap.height );
      const canvas = document.createElement( "canvas" );
      canvas.width = Math.max( 1 , Math.round( bitmap.width * k ) );
      canvas.height = Math.max( 1 , Math.round( bitmap.height * k ) );
      canvas.getContext( "2d" ).drawImage( bitmap , 0 , 0 , canvas.width , canvas.height );
      return canvas.toDataURL( "image/png" );
    } catch ( error ) {
      return "";
    }
  },

  // Resolves once every picture the trial figures need is ready to embed.
  load( doc ) {
    if ( this.loading ) return this.loading;
    const missing = this.picturesNeeded( doc ).filter( ( sha ) => this.pictures[ sha ] === undefined );
    if ( !missing.length ) return Promise.resolve( false );
    this.loading = Promise.all( missing.map( async ( sha ) => { this.pictures[ sha ] = await this.smallCopy( sha ); } ) ).then( () => {
      this.loading = null;
      return true;
    } );
    return this.loading;
  },

  // The screen a layer list makes, in a box x, y, w, h: the same geometry as
  // display.js, in plain SVG so it survives being saved.
  screen( svg , pal , doc , x , y , w , h , layers ) {
    const clip = "screen" + Math.random().toString( 36 ).slice( 2 , 8 );
    const path = Charts.node( "clipPath" , { id: clip } , Charts.node( "defs" , {} , svg ) );
    Charts.node( "rect" , { x: x , y: y , width: w , height: h , rx: 3 } , path );
    Charts.node( "rect" , { x: x , y: y , width: w , height: h , rx: 3 , fill: doc.display.background } , svg );
    const inside = Charts.node( "g" , { "clip-path": "url(#" + clip + ")" } , svg );
    const X = ( px ) => x + w / 2 + px * h;
    const Y = ( py ) => y + h / 2 - py * h;
    layers.forEach( ( layer ) => {
      if ( layer.kind === "text" ) this.screenText( inside , doc , layer , X , Y , h );
      else if ( layer.kind === "image" ) this.screenPicture( inside , pal , doc , layer , X , Y , h );
      else this.screenShape( inside , layer , X , Y , h );
    } );
    Charts.node( "rect" , { x: x , y: y , width: w , height: h , rx: 3 , fill: "none" , stroke: pal.axis } , svg );
  },

  screenText( parent , doc , layer , X , Y , h ) {
    const size = layer.height * h;
    const perLine = Math.max( 1 , Math.floor( ( layer.wrap || 1.2 ) / ( layer.height * 0.5 ) ) );
    const lines = [];
    layer.text.split( "\n" ).forEach( ( paragraph ) => {
      let line = "";
      paragraph.split( " " ).forEach( ( word ) => {
        if ( line && ( line + " " + word ).length > perLine ) {
          lines.push( line );
          line = word;
        } else {
          line = line ? line + " " + word : word;
        }
      } );
      lines.push( line );
    } );
    const top = Y( layer.pos[ 1 ] ) - ( ( lines.length - 1 ) * size * 1.2 ) / 2 + size * 0.35;
    lines.forEach( ( line , index ) => Charts.text( parent , X( layer.pos[ 0 ] ) , top + index * size * 1.2 , line , {
      "text-anchor": "middle" , fill: layer.color , "font-size": size , "font-weight": layer.bold ? 700 : 400 , "font-family": doc.display.font,
    } ) );
  },

  screenPicture( parent , pal , doc , layer , X , Y , h ) {
    const entry = doc.media.find( ( m ) => m.id === layer.media );
    const height = layer.height * h;
    const width = layer.width ? layer.width * h : height * ( entry ? entry.w / entry.h : 1 );
    const left = X( layer.pos[ 0 ] ) - width / 2;
    const top = Y( layer.pos[ 1 ] ) - height / 2;
    const data = this.pictures[ layer.media ];
    if ( data ) {
      Charts.node( "image" , { href: data , x: left , y: top , width: width , height: height , preserveAspectRatio: "none" } , parent );
      return;
    }
    Charts.node( "rect" , { x: left , y: top , width: width , height: height , fill: pal.axis , "fill-opacity": 0.4 } , parent );
    Charts.text( parent , left + width / 2 , top + height / 2 + 3 , ( entry ? entry.name : "" ).slice( 0 , 16 ) , { "text-anchor": "middle" , fill: "#ffffff" , "font-size": 8 } );
  },

  screenShape( parent , layer , X , Y , h ) {
    const size = layer.size * h;
    const cx = X( layer.pos[ 0 ] );
    const cy = Y( layer.pos[ 1 ] );
    const paint = { fill: layer.fill === false ? "none" : layer.color , stroke: layer.color , "stroke-width": 1 };
    if ( layer.ori ) paint.transform = "rotate(" + layer.ori + " " + cx + " " + cy + ")";
    if ( layer.shape === "circle" ) Charts.node( "circle" , Object.assign( { cx: cx , cy: cy , r: size / 2 } , paint ) , parent );
    else if ( layer.shape === "square" ) Charts.node( "rect" , Object.assign( { x: cx - size / 2 , y: cy - size / 2 , width: size , height: size } , paint ) , parent );
    else Charts.node( "polygon" , Object.assign( { points: Display.points( layer ).map( ( p ) => ( cx + p[ 0 ] * size ).toFixed( 2 ) + "," + ( cy + p[ 1 ] * size ).toFixed( 2 ) ).join( " " ) } , paint ) , parent );
  },

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

  // Each phase's screen and length across the top, the cumulative mean onset
  // of each on a line below, and then the same phases to scale.
  trial( doc , tt , light , size ) {
    const pal = Charts.palette( light );
    const w = Math.max( this.MIN_WIDTH , Math.round( size || this.WIDTH ) );
    const parts = this.phaseParts( doc , tt );
    const slot = ( w - 32 ) / Math.max( 1 , parts.length );
    const screenWidth = Math.min( 150 , slot - 12 );
    const screenHeight = screenWidth / doc.display.aspect;
    const labels = 52 + screenHeight + 16;
    const axis = labels + 46;
    const bar = axis + 38;
    const h = bar + 40 + 62;
    const svg = Charts.svg( w , h , pal );
    const hatch = this.hatch( svg , pal );
    const span = Timing.trial( doc , tt );
    this.title( svg , pal , tt.name || I18n.get( "trials.unnamed" ) , I18n.get( "figures.trial_sub" ).replace( "{span}" , Timing.describe( span ) ) );

    const screens = this.screens( doc , tt );
    const fit = ( text , size ) => String( text ).slice( 0 , Math.max( 4 , Math.floor( slot / size ) ) );
    let onset = 0;
    const onsets = [ 0 ];
    parts.forEach( ( part , index ) => {
      const cx = 16 + slot * ( index + 0.5 );
      this.screen( svg , pal , doc , cx - screenWidth / 2 , 52 , screenWidth , screenHeight , screens[ index ] );
      Charts.text( svg , cx , labels , fit( part.label , 6.2 ) , { "text-anchor": "middle" , fill: pal.text , "font-size": 11 , "font-weight": 600 } );
      Charts.text( svg , cx , labels + 13 , part.sub , { "text-anchor": "middle" , fill: pal.series[ 0 ] , "font-size": 10.5 } );
      const d = part.phase.duration;
      if ( d.kind !== "fixed" ) {
        const note = I18n.get( "figures.jitter_note" ).replace( "{kind}" , I18n.get( "settings.jitter_mode_" + d.kind ) ).replace( "{mean}" , Charts.number( Math.round( part.span.mean * 100 ) / 100 ) );
        Charts.text( svg , cx , labels + 25 , fit( note , 4.9 ) , { "text-anchor": "middle" , fill: pal.muted , "font-size": 9.5 } );
      }
      onset += part.span.mean;
      onsets.push( onset );
    } );

    Charts.node( "line" , { x1: 16 , x2: w - 16 , y1: axis , y2: axis , stroke: pal.text , "stroke-width": 1.5 } , svg );
    onsets.forEach( ( t , index ) => {
      const x = 16 + slot * index;
      Charts.node( "line" , { x1: x , x2: x , y1: axis - 11 , y2: axis , stroke: pal.series[ 0 ] , "stroke-width": 1.5 } , svg );
      Charts.node( "polygon" , { points: ( x - 3 ) + "," + ( axis - 10 ) + " " + ( x + 3 ) + "," + ( axis - 10 ) + " " + x + "," + ( axis - 15 ) , fill: pal.series[ 0 ] } , svg );
      const anchor = index === 0 ? "start" : index === onsets.length - 1 ? "end" : "middle";
      Charts.text( svg , x , axis + 14 , I18n.get( "figures.onset" ).replace( "{t}" , Charts.number( Math.round( t * 100 ) / 100 ) ) , { "text-anchor": anchor , fill: pal.text , "font-size": 10 } );
    } );

    const placed = this.strip( svg , pal , hatch , 16 , bar , w - 32 , 40 , parts );
    placed.forEach( ( p ) => {
      Charts.node( "line" , { x1: p.x0 , x2: p.x0 , y1: bar - 5 , y2: bar + 44 , stroke: pal.axis , "stroke-width": 0.8 } , svg );
      if ( p.part.phase.modelled ) Charts.text( svg , p.x0 + 3 , bar + 56 , "◆ " + I18n.get( "figures.modelled" ) , { fill: pal.series[ 0 ] , "font-size": 9.5 } );
    } );
    this.ruler( svg , pal , 16 , bar + 62 - 2 , w - 32 , parts.reduce( ( s , p ) => s + p.seconds , 0 ) );
    if ( this.picturesNeeded( doc ).some( ( sha ) => this.pictures[ sha ] === undefined ) ) {
      this.load( doc ).then( ( fresh ) => { if ( fresh ) Designer.repaint( Nav.current() ); } );
    }
    return svg;
  },

  // -- a run ---------------------------------------------------------------

  runParts( doc , run , info , pal ) {
    const parts = [];
    const add = ( p ) => { if ( p.seconds > 0 ) parts.push( p ); };
    add( { label: I18n.get( "runs.dummies" ) , short: I18n.get( "figures.dummies_short" ) , seconds: info.dummy * info.tr , muted: true , color: pal.axis } );
    add( { label: I18n.get( "runs.lead_in" ) , seconds: Timing.leadSpan( run.lead_in , Timing.scan( doc , run ).tr ).mean , muted: true , color: pal.axis } );
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
    add( { label: I18n.get( "runs.lead_out" ) , seconds: Timing.leadSpan( run.lead_out , Timing.scan( doc , run ).tr ).mean , muted: true , color: pal.axis } );
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

  // -- the whole study --------------------------------------------------------

  // Every session type at its count, for everyone, against the hours you have.
  overview( doc , light , size ) {
    const pal = Charts.palette( light );
    const w = Math.max( this.MIN_WIDTH , Math.round( size || this.WIDTH ) );
    const budget = Timing.budget( doc );
    const people = doc.budget.participants;
    const rows = budget.rows.map( ( row , index ) => ( { row: row , color: Overview.color( index ) , hours: row.hours * people } ) ).filter( ( r ) => r.hours > 0 );
    const x = 96;
    const width = w - x - 84;
    const legend = [];
    let line = [];
    let used = 0;
    rows.forEach( ( r ) => {
      const text = ( r.row.session.name || I18n.get( "sessions.unnamed" ) ) + " ×" + r.row.session.count * people + " · " + Timing.hours( r.hours );
      const need = 26 + text.length * 5.8;
      if ( line.length && used + need > w - 32 ) {
        legend.push( line );
        line = [];
        used = 0;
      }
      line.push( { text: text , color: r.color , at: used } );
      used += need;
    } );
    if ( line.length ) legend.push( line );
    const h = 160 + legend.length * 18 + 22;
    const svg = Charts.svg( w , h , pal );
    const hatch = this.hatch( svg , pal );
    const key = budget.available > 0 ? "figures.overview_title" : "figures.overview_title_open";
    this.title( svg , pal , doc.name || I18n.get( "experiments.untitled" ) , I18n.get( key ).replace( "{used}" , Timing.hours( budget.used ) ).replace( "{available}" , Timing.hours( budget.available ) ) );
    const scale = Math.max( budget.available , budget.used , 1e-9 );
    const X = ( hours ) => x + ( hours / scale ) * width;
    const step = Charts.niceStep( scale , Math.max( 3 , Math.round( width / 90 ) ) );
    for ( let t = 0; t <= scale + 1e-9; t += step ) {
      Charts.node( "line" , { x1: X( t ) , x2: X( t ) , y1: 62 , y2: 136 , stroke: pal.axis , "stroke-opacity": 0.4 } , svg );
      Charts.text( svg , X( t ) , 58 , Charts.number( t ) + " h" , { "text-anchor": "middle" , fill: pal.muted , "font-size": 10 } );
    }
    const label = ( y , text ) => Charts.text( svg , x - 8 , y , text , { "text-anchor": "end" , fill: pal.muted , "font-size": 11 , "font-weight": 600 } );
    label( 90 , I18n.get( "figures.row_study" ) );
    this.strip( svg , pal , hatch , x , 68 , X( budget.used ) - x , 36 , rows.map( ( r ) => ( {
      label: ( r.row.session.name || I18n.get( "sessions.unnamed" ) ) + " ×" + r.row.session.count * people , seconds: r.hours * 3600 , color: r.color,
    } ) ) );
    Charts.text( svg , X( budget.used ) + 6 , 90 , Timing.hours( budget.used ) , { fill: pal.text , "font-size": 11 } );
    if ( budget.available > 0 ) {
      label( 127 , I18n.get( "figures.row_available" ) );
      const over = budget.used > budget.available;
      Charts.node( "rect" , { x: x , y: 114 , width: X( budget.available ) - x , height: 18 , rx: 2 , fill: "none" , stroke: pal.axis } , svg );
      Charts.node( "rect" , { x: x , y: 114 , width: X( Math.min( budget.used , budget.available ) ) - x , height: 18 , rx: 2 , fill: over ? pal.series[ 3 ] : pal.series[ 0 ] , "fill-opacity": 0.75 } , svg );
      Charts.text( svg , X( Math.max( budget.available , budget.used ) ) + 6 , 127 , Math.round( ( budget.used / budget.available ) * 100 ) + "%" , { fill: pal.text , "font-size": 11 } );
    }
    legend.forEach( ( entries , row ) => entries.forEach( ( entry ) => {
      const y = 150 + row * 18;
      Charts.node( "rect" , { x: 16 + entry.at , y: y , width: 11 , height: 11 , rx: 2 , fill: entry.color } , svg );
      Charts.text( svg , 16 + entry.at + 16 , y + 10 , entry.text , { fill: pal.muted , "font-size": 10.5 } );
    } ) );
    const runs = budget.rows.reduce( ( n , r ) => n + r.info.runs * r.session.count , 0 ) * people;
    const trials = budget.rows.reduce( ( n , r ) => n + r.info.trials * r.session.count , 0 ) * people;
    const data = Timing.dataVolume( doc );
    let footer = I18n.get( "figures.overview_footer" ).replace( "{sessions}" , Timing.calendar( doc ).sessions ).replace( "{runs}" , runs ).replace( "{trials}" , trials );
    if ( data.total > 0 ) footer += " · " + Timing.size( data.total );
    Charts.text( svg , 16 , 160 + legend.length * 18 + 8 , footer , { fill: pal.muted , "font-size": 10.5 } );
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
    if ( doc.sessions.length ) out.push( { name: "overview" , make: ( light , width ) => this.overview( doc , light , width ) } );
    doc.trial_types.forEach( ( tt ) => out.push( { name: "trial-" + ( tt.name || tt.id ) , make: ( light , width ) => this.trial( doc , tt , light , width ) } ) );
    doc.runs.forEach( ( run ) => out.push( { name: "run-" + ( run.name || run.id ) , make: ( light , width ) => this.run( doc , run , light , width ) } ) );
    doc.sessions.forEach( ( s ) => out.push( { name: "session-" + ( s.name || s.id ) , make: ( light , width ) => this.session( doc , s , light , width ) } ) );
    return out;
  },
};
