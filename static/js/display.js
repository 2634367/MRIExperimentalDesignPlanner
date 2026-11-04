// Draws resolved layers (compile.js's output) in PsychoPy's "height" units:
// the screen is 1 tall, x runs from -aspect/2 to +aspect/2, y from -0.5
// (bottom) to +0.5 (top), and a position is the centre of what is drawn.
//
// Every preview in the editor and the browser player draw through here, and
// runner/fmri_runner/display.py draws the same layers the same way in
// PsychoPy, so what you see while designing is what the participant sees.
//
// Sizing is CSS: the screen element carries --u (its height in px, kept up
// to date by a ResizeObserver) and each layer is placed with calc() against
// it, so a preview of any size needs no redraw when it is resized.
const Display = {
  SVG: "http://www.w3.org/2000/svg",

  // A screen box. aspect is width / height; fill true makes it take its
  // container's whole size instead (the player).
  screen( aspect , fill ) {
    const box = Dom.el( "div" , { class: "disp-screen" + ( fill ? " disp-fill" : "" ) } );
    if ( !fill ) box.style.aspectRatio = String( aspect || 1.6 );
    const observer = new ResizeObserver( () => box.style.setProperty( "--u" , box.clientHeight + "px" ) );
    observer.observe( box );
    return box;
  },

  render( box , layers , context ) {
    const ctx = context || {};
    box.style.background = ctx.background || "#000000";
    box.style.fontFamily = '"' + ( ctx.font || "Arial" ) + '", Helvetica, Arial, sans-serif';
    box.replaceChildren( ...( layers || [] ).map( ( layer ) => this.layer( layer , ctx ) ) );
  },

  place( node , layer , height ) {
    node.style.setProperty( "--x" , layer.pos[ 0 ] );
    node.style.setProperty( "--y" , layer.pos[ 1 ] );
    node.style.setProperty( "--h" , height );
    return node;
  },

  layer( layer , ctx ) {
    if ( layer.kind === "text" ) {
      const node = this.place( Dom.el( "div" , { class: "disp-el disp-text" , text: layer.text } ) , layer , layer.height );
      node.style.color = layer.color;
      node.style.setProperty( "--w" , layer.wrap || 99 );
      if ( layer.bold ) node.style.fontWeight = "700";
      return node;
    }
    if ( layer.kind === "image" ) {
      const node = this.place( Dom.el( "img" , { class: "disp-el disp-image" , attrs: { alt: "" , draggable: "false" } } ) , layer , layer.height );
      if ( layer.width ) node.style.setProperty( "--iw" , layer.width );
      const url = ctx.mediaUrl ? ctx.mediaUrl( layer.media ) : "";
      if ( url ) node.src = url;
      return node;
    }
    return this.shape( layer );
  },

  // The same geometry as display.py: a polygon's first corner points up,
  // a cross is two bars a fifth as thick as they are long.
  points( layer ) {
    if ( layer.shape === "cross" ) {
      const h = 0.5;
      const t = 0.1;
      return [ [ -t , -h ] , [ t , -h ] , [ t , -t ] , [ h , -t ] , [ h , t ] , [ t , t ] , [ t , h ] , [ -t , h ] , [ -t , t ] , [ -h , t ] , [ -h , -t ] , [ -t , -t ] ];
    }
    const edges = layer.shape === "triangle" ? 3 : layer.shape === "diamond" ? 4 : layer.sides || 5;
    const step = ( Math.PI * 2 ) / edges;
    const out = [];
    for ( let e = 0; e < edges; e += 1 ) out.push( [ Math.sin( e * step ) * 0.5 , -Math.cos( e * step ) * 0.5 ] );
    return out;
  },

  shape( layer ) {
    const svg = document.createElementNS( this.SVG , "svg" );
    svg.setAttribute( "viewBox" , "-0.5 -0.5 1 1" );
    svg.setAttribute( "class" , "disp-el disp-shape" );
    svg.setAttribute( "overflow" , "visible" );
    this.place( svg , layer , layer.size );
    if ( layer.ori ) svg.style.setProperty( "--ori" , layer.ori + "deg" );
    let node;
    if ( layer.shape === "circle" ) {
      node = document.createElementNS( this.SVG , "circle" );
      node.setAttribute( "r" , "0.5" );
    } else if ( layer.shape === "square" ) {
      node = document.createElementNS( this.SVG , "rect" );
      [ [ "x" , "-0.5" ] , [ "y" , "-0.5" ] , [ "width" , "1" ] , [ "height" , "1" ] ].forEach( ( a ) => node.setAttribute( a[ 0 ] , a[ 1 ] ) );
    } else {
      node = document.createElementNS( this.SVG , "polygon" );
      node.setAttribute( "points" , this.points( layer ).map( ( p ) => p[ 0 ].toFixed( 4 ) + "," + p[ 1 ].toFixed( 4 ) ).join( " " ) );
    }
    node.setAttribute( "fill" , layer.fill === false ? "none" : layer.color );
    node.setAttribute( "stroke" , layer.color );
    node.setAttribute( "stroke-width" , String( layer.line_width || 3 ) );
    node.setAttribute( "vector-effect" , "non-scaling-stroke" );
    svg.appendChild( node );
    return svg;
  },

  // A preview of design layers (not yet compiled) for one item.
  preview( box , doc , layers , item , list , mediaUrl ) {
    this.render( box , Compile.resolveLayers( doc , layers , item , list ) , {
      background: doc.display.background , font: doc.display.font , mediaUrl: mediaUrl,
    } );
  },
};
