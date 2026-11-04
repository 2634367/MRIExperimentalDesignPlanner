// Hand-built SVG charts: a line plot that zooms and pans, a bar chart, and a
// card that offers any figure as an SVG or PNG download. There is no chart
// library: the CSP allows only this origin's scripts and no inline styles,
// so every colour and font is a presentation attribute. That also makes
// an exported SVG look exactly like the one on screen.
//
// Colours come from the palettes below rather than CSS, so a figure can be
// drawn in the light palette for a download even while the page is dark.
const Charts = {
  NS: "http://www.w3.org/2000/svg",
  FONT: "system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif",
  LIGHT: {
    background: "#ffffff" , text: "#1f2328" , muted: "#59636e" , grid: "#e6e9ed" , axis: "#8c959f" , band: "#1f5fd6" ,
    series: [ "#1f5fd6" , "#d9622b" , "#2a9d6f" , "#8e44ad" , "#c0392b" , "#8a7a00" ],
  },
  DARK: {
    background: "#191c21" , text: "#e6e8eb" , muted: "#9aa4b0" , grid: "#2c3138" , axis: "#6b7480" , band: "#6ea0ff" ,
    series: [ "#6ea0ff" , "#f08a55" , "#4cc493" , "#b57bd6" , "#e8665a" , "#c9b739" ],
  },
  // Zoom windows survive the screen repainting after every edit.
  views: new Map(),
  // The curves hidden on each plot, by spec.hideKey (else spec.key).
  hidden: new Map(),

  palette( light ) {
    return light || document.documentElement.getAttribute( "data-bs-theme" ) !== "dark" ? this.LIGHT : this.DARK;
  },

  node( tag , attrs , parent ) {
    const el = document.createElementNS( this.NS , tag );
    Object.entries( attrs || {} ).forEach( ( [ k , v ] ) => { if ( v != null ) el.setAttribute( k , String( v ) ); } );
    if ( parent ) parent.appendChild( el );
    return el;
  },

  text( parent , x , y , value , attrs ) {
    const el = this.node( "text" , Object.assign( { x: x , y: y , "font-size": 11 } , attrs || {} ) , parent );
    el.textContent = value;
    return el;
  },

  svg( width , height , pal ) {
    const svg = this.node( "svg" , {
      xmlns: this.NS , viewBox: "0 0 " + width + " " + height , width: width , height: height ,
      "font-family": this.FONT , class: "chart-svg" , role: "img",
    } );
    this.node( "rect" , { x: 0 , y: 0 , width: width , height: height , fill: pal.background } , svg );
    return svg;
  },

  // A round tick step giving about `target` ticks over range.
  niceStep( range , target ) {
    const raw = range / ( target || 6 );
    if ( !( raw > 0 ) ) return 1;
    const base = Math.pow( 10 , Math.floor( Math.log10( raw ) ) );
    return [ 1 , 2 , 2.5 , 5 , 10 ].map( ( m ) => m * base ).find( ( s ) => s >= raw ) || 10 * base;
  },

  number( x ) {
    const r = Math.round( x * 1000 ) / 1000;
    return String( r );
  },

  // -- the line plot ------------------------------------------------------
  //
  // spec: { key, height, t[], series[{ label, values[], color?, width?, dash? }],
  //         bands[{ x0, x1, series? }], vlines[{ x, label?, series?, color?, dash?, row? }],
  //         markers[{ x, y, label?, series? }], xLabel, zoom (bool),
  //         buttons[{ text, icon, run(view) }], light (bool), width?, hideKey? }
  // Returns { element, svg(), shown(i), setShown(i, on), onChange(fn) } --
  // svg() draws a fresh copy for export, without the curves hidden on screen.
  linePlot( spec ) {
    const wrap = Dom.el( "div" , { class: "chart" } );
    const host = Dom.el( "div" , { class: "chart-host" } );
    const readout = Dom.el( "div" , { class: "chart-readout small text-body-secondary" , text: " " } );
    const t = spec.t;
    const full = [ t[ 0 ] , t[ t.length - 1 ] ];
    const saved = spec.key && this.views.get( spec.key );
    const view = saved && saved.full[ 0 ] === full[ 0 ] && saved.full[ 1 ] === full[ 1 ] ? saved : { x0: full[ 0 ] , x1: full[ 1 ] , full: full };
    const remember = () => { if ( spec.key ) this.views.set( spec.key , view ); };
    // Clicking a legend item (or a table's checkbox) hides or shows a curve.
    const hideKey = spec.hideKey || spec.key;
    const hidden = ( hideKey && this.hidden.get( hideKey ) ) || new Set();
    if ( hideKey ) this.hidden.set( hideKey , hidden );
    spec.hidden = hidden;
    const listeners = [];
    const clamp = () => {
      const span = Math.max( ( full[ 1 ] - full[ 0 ] ) / 200 , Math.min( full[ 1 ] - full[ 0 ] , view.x1 - view.x0 ) );
      view.x0 = Math.max( full[ 0 ] , Math.min( full[ 1 ] - span , view.x0 ) );
      view.x1 = view.x0 + span;
      remember();
    };
    const zoomBy = ( factor , centre ) => {
      const c = centre == null ? ( view.x0 + view.x1 ) / 2 : centre;
      view.x0 = c - ( c - view.x0 ) * factor;
      view.x1 = c + ( view.x1 - c ) * factor;
      clamp();
      draw();
    };
    // The zoom slider: 0 shows everything, 100 the narrowest span clamp()
    // allows, on a log scale so each step zooms by the same factor.
    const fullSpan = full[ 1 ] - full[ 0 ];
    const slider = spec.zoom ? Dom.el( "input" , { class: "form-range chart-zoom" , attrs: { type: "range" , min: 0 , max: 100 , step: 1 , "aria-label": I18n.get( "charts.zoom" ) } } ) : null;
    const sliderLevel = () => Math.round( ( Math.log( fullSpan / ( view.x1 - view.x0 ) ) / Math.log( 200 ) ) * 100 );
    let geometry = null;
    const draw = () => {
      const width = Math.max( 280 , Math.round( host.clientWidth || spec.width || 720 ) );
      const built = this.drawLines( spec , view , width , this.palette( spec.light ) );
      geometry = built.geometry;
      host.replaceChildren( built.svg );
      if ( slider && document.activeElement !== slider ) slider.value = sliderLevel();
    };

    if ( spec.zoom ) {
      const bar = Dom.el( "div" , { class: "chart-tools" } );
      bar.appendChild( Dom.el( "span" , { class: "small text-body-secondary" , text: I18n.get( "charts.zoom" ) } ) );
      slider.addEventListener( "input" , () => {
        const span = fullSpan / Math.pow( 200 , Number( slider.value ) / 100 );
        const c = ( view.x0 + view.x1 ) / 2;
        view.x0 = c - span / 2;
        view.x1 = c + span / 2;
        clamp();
        draw();
      } );
      bar.appendChild( slider );
      bar.appendChild( Ui.icon( "zoom-out" , I18n.get( "charts.zoom_out" ) , () => zoomBy( 1.6 ) ) );
      bar.appendChild( Ui.icon( "zoom-in" , I18n.get( "charts.zoom_in" ) , () => zoomBy( 1 / 1.6 ) ) );
      bar.appendChild( Ui.button( I18n.get( "charts.fit" ) , "arrows-angle-expand" , () => { view.x0 = full[ 0 ]; view.x1 = full[ 1 ]; clamp(); draw(); } , { small: true } ) );
      ( spec.buttons || [] ).forEach( ( b ) => bar.appendChild( Ui.button( b.text , b.icon , () => { b.run( view , full ); clamp(); draw(); } , { small: true } ) ) );
      bar.appendChild( Dom.el( "span" , { class: "small text-body-secondary ms-auto chart-hint" , text: I18n.get( "charts.hint" ) } ) );
      wrap.appendChild( bar );
      // Ctrl/⌘ + wheel (and a trackpad pinch, which arrives as one) zooms
      // around the pointer; a plain wheel still scrolls the page.
      host.addEventListener( "wheel" , ( event ) => {
        if ( !( event.ctrlKey || event.metaKey ) || !geometry ) return;
        event.preventDefault();
        zoomBy( event.deltaY > 0 ? 1.18 : 1 / 1.18 , geometry.timeAt( event ) );
      } , { passive: false } );
      host.addEventListener( "dblclick" , () => { view.x0 = full[ 0 ]; view.x1 = full[ 1 ]; clamp(); draw(); } );
      host.addEventListener( "pointerdown" , ( event ) => {
        if ( !geometry || event.button !== 0 ) return;
        const startX = event.clientX;
        const start = { x0: view.x0 , x1: view.x1 };
        const perPixel = ( view.x1 - view.x0 ) / geometry.plotWidthPx();
        host.setPointerCapture( event.pointerId );
        const move = ( e ) => {
          const shift = ( startX - e.clientX ) * perPixel;
          view.x0 = start.x0 + shift;
          view.x1 = start.x1 + shift;
          clamp();
          draw();
        };
        const up = () => {
          host.removeEventListener( "pointermove" , move );
          host.removeEventListener( "pointerup" , up );
        };
        host.addEventListener( "pointermove" , move );
        host.addEventListener( "pointerup" , up );
      } );
    }
    host.addEventListener( "pointermove" , ( event ) => {
      if ( !geometry ) return;
      const x = geometry.timeAt( event );
      let index = 0;
      let lo = 0;
      let hi = t.length - 1;
      while ( lo <= hi ) {
        const mid = ( lo + hi ) >> 1;
        if ( t[ mid ] < x ) lo = mid + 1; else hi = mid - 1;
      }
      index = Math.min( t.length - 1 , lo );
      geometry.cursor( t[ index ] );
      readout.textContent = Charts.number( t[ index ] ) + " s · " + spec.series.filter( ( s , i ) => !hidden.has( i ) ).map( ( s ) => s.label + " " + Charts.number( s.values[ index ] ) ).join( " · " );
    } );
    host.addEventListener( "pointerleave" , () => { if ( geometry ) geometry.cursor( null ); readout.textContent = " "; } );

    wrap.appendChild( host );
    wrap.appendChild( readout );
    const setShown = ( i , on ) => {
      if ( on ) hidden.delete( i ); else hidden.add( i );
      draw();
      listeners.forEach( ( fn ) => fn() );
    };
    if ( spec.series.length > 1 || spec.legend ) {
      const legend = this.legend( spec.series , this.palette( spec.light ) , hidden , ( i ) => setShown( i , hidden.has( i ) ) );
      listeners.push( legend.sync );
      wrap.appendChild( legend );
    }
    // Drawn once attached (it needs a width), and again when that changes.
    let lastWidth = 0;
    const observer = new ResizeObserver( () => {
      if ( Math.abs( host.clientWidth - lastWidth ) < 2 ) return;
      lastWidth = host.clientWidth;
      draw();
    } );
    observer.observe( host );
    requestAnimationFrame( () => { if ( !host.firstChild ) draw(); } );
    return {
      element: wrap,
      shown: ( i ) => !hidden.has( i ),
      setShown: setShown,
      onChange: ( fn ) => listeners.push( fn ),
      svg: ( light ) => this.drawLines( Object.assign( {} , spec , { light: light } ) , { x0: full[ 0 ] , x1: full[ 1 ] } , spec.width || 900 , this.palette( light ) , true ).svg,
    };
  },

  // With toggle(i), each item is a button that hides or shows its curve.
  legend( series , pal , hidden , toggle ) {
    const box = Dom.el( "div" , { class: "chart-legend small" } );
    const items = series.map( ( s , i ) => {
      const swatch = Dom.el( "span" , { class: "swatch" } );
      swatch.style.background = s.color || pal.series[ i % pal.series.length ];
      const children = [ swatch , Dom.el( "span" , { text: s.label } ) ];
      const item = toggle
        ? Dom.el( "button" , { class: "chart-legend-item chart-legend-toggle" , attrs: { type: "button" , title: I18n.get( "charts.toggle_curve" ) } , children: children } )
        : Dom.el( "span" , { class: "chart-legend-item" , children: children } );
      if ( toggle ) item.addEventListener( "click" , () => toggle( i ) );
      box.appendChild( item );
      return item;
    } );
    box.sync = () => items.forEach( ( item , i ) => {
      const off = !!hidden && hidden.has( i );
      item.classList.toggle( "off" , off );
      if ( toggle ) item.setAttribute( "aria-pressed" , off ? "false" : "true" );
    } );
    box.sync();
    return box;
  },

  drawLines( spec , view , width , pal , exporting ) {
    const height = spec.height || 260;
    const hidden = spec.hidden || new Set();
    const shown = ( i ) => i == null || !hidden.has( i );
    const legendRows = exporting && spec.series.length - hidden.size > 1 ? 1 : 0;
    const pad = { left: 52 , right: 16 , top: 14 , bottom: 34 + legendRows * 20 };
    const svg = this.svg( width , height , pal );
    if ( spec.title && exporting ) {
      pad.top = 30;
      this.text( svg , pad.left , 18 , spec.title , { "font-size": 13 , "font-weight": 600 , fill: pal.text } );
    }
    const pw = width - pad.left - pad.right;
    const ph = height - pad.top - pad.bottom;
    const t = spec.t;
    const color = ( i ) => spec.series[ i ].color || pal.series[ i % pal.series.length ];
    let lo = 0;
    let hi = 0;
    spec.series.forEach( ( s , i ) => shown( i ) && s.values.forEach( ( v , k ) => {
      if ( t[ k ] < view.x0 || t[ k ] > view.x1 ) return;
      if ( v < lo ) lo = v;
      if ( v > hi ) hi = v;
    } ) );
    if ( hi - lo < 1e-9 ) hi = lo + 1;
    const margin = ( hi - lo ) * 0.08;
    lo -= lo < 0 ? margin : 0;
    hi += margin;
    const X = ( x ) => pad.left + ( ( x - view.x0 ) / ( view.x1 - view.x0 ) ) * pw;
    const Y = ( y ) => pad.top + ( 1 - ( y - lo ) / ( hi - lo ) ) * ph;
    const clipId = "clip" + Math.random().toString( 36 ).slice( 2 , 8 );
    const defs = this.node( "defs" , {} , svg );
    this.node( "rect" , { x: pad.left , y: pad.top , width: pw , height: ph } , this.node( "clipPath" , { id: clipId } , defs ) );

    // Grid and axes.
    const ystep = this.niceStep( hi - lo , 5 );
    for ( let y = Math.ceil( lo / ystep ) * ystep; y <= hi + 1e-9; y += ystep ) {
      this.node( "line" , { x1: pad.left , x2: pad.left + pw , y1: Y( y ) , y2: Y( y ) , stroke: Math.abs( y ) < 1e-9 ? pal.axis : pal.grid , "stroke-width": 1 } , svg );
      this.text( svg , pad.left - 6 , Y( y ) + 4 , this.number( y ) , { "text-anchor": "end" , fill: pal.muted } );
    }
    const xstep = this.niceStep( view.x1 - view.x0 , Math.max( 3 , Math.round( pw / 90 ) ) );
    for ( let x = Math.ceil( view.x0 / xstep ) * xstep; x <= view.x1 + 1e-9; x += xstep ) {
      this.node( "line" , { x1: X( x ) , x2: X( x ) , y1: pad.top + ph , y2: pad.top + ph + 4 , stroke: pal.axis } , svg );
      this.text( svg , X( x ) , pad.top + ph + 16 , this.number( x ) , { "text-anchor": "middle" , fill: pal.muted } );
    }
    this.text( svg , pad.left + pw , pad.top + ph + 30 , spec.xLabel || I18n.get( "charts.seconds" ) , { "text-anchor": "end" , fill: pal.muted , "font-size": 10 } );

    const plot = this.node( "g" , { "clip-path": "url(#" + clipId + ")" } , svg );
    ( spec.bands || [] ).forEach( ( b ) => {
      if ( b.x1 < view.x0 || b.x0 > view.x1 || !shown( b.series ) ) return;
      this.node( "rect" , {
        x: X( b.x0 ) , y: pad.top , width: Math.max( 0.5 , X( b.x1 ) - X( b.x0 ) ) , height: ph ,
        fill: b.series == null ? pal.band : color( b.series ) , "fill-opacity": b.opacity || 0.12,
      } , plot );
    } );
    ( spec.vlines || [] ).forEach( ( v ) => {
      if ( v.x < view.x0 || v.x > view.x1 || !shown( v.series ) ) return;
      // series: a palette slot, so an export redraws it in the light palette.
      const vc = v.series != null ? pal.series[ v.series % pal.series.length ] : v.color;
      this.node( "line" , { x1: X( v.x ) , x2: X( v.x ) , y1: pad.top , y2: pad.top + ph , stroke: vc || pal.axis , "stroke-dasharray": v.dash || "4 3" , "stroke-width": 1 } , plot );
      if ( v.label ) this.text( plot , X( v.x ) + 4 , pad.top + 12 + ( v.row || 0 ) * 13 , v.label , { fill: vc || pal.muted , "font-size": 10 } );
    } );
    spec.series.forEach( ( s , i ) => {
      if ( !shown( i ) ) return;
      // At most ~2 points per pixel: a long run stays light to draw.
      const visible = [];
      t.forEach( ( x , k ) => { if ( x >= view.x0 - 1 && x <= view.x1 + 1 ) visible.push( k ); } );
      const stride = Math.max( 1 , Math.floor( visible.length / ( pw * 2 ) ) );
      const points = [];
      for ( let j = 0; j < visible.length; j += stride ) points.push( X( t[ visible[ j ] ] ).toFixed( 1 ) + "," + Y( s.values[ visible[ j ] ] ).toFixed( 1 ) );
      this.node( "polyline" , { points: points.join( " " ) , fill: "none" , stroke: color( i ) , "stroke-width": s.width || 1.8 , "stroke-dasharray": s.dash || null , "stroke-linejoin": "round" } , plot );
    } );
    ( spec.markers || [] ).forEach( ( m ) => {
      if ( m.x < view.x0 || m.x > view.x1 || !shown( m.series ) ) return;
      const c = m.series == null ? pal.text : color( m.series );
      this.node( "line" , { x1: X( m.x ) , x2: X( m.x ) , y1: Y( m.y ) , y2: Y( 0 ) , stroke: c , "stroke-dasharray": "2 2" } , plot );
      this.node( "circle" , { cx: X( m.x ) , cy: Y( m.y ) , r: 3.5 , fill: c } , plot );
      if ( m.label ) this.text( plot , X( m.x ) + 5 , Y( m.y ) - 6 , m.label , { fill: c , "font-size": 10 } );
    } );
    if ( legendRows ) {
      let x = pad.left;
      spec.series.forEach( ( s , i ) => {
        if ( !shown( i ) ) return;
        this.node( "rect" , { x: x , y: height - 16 , width: 10 , height: 10 , rx: 2 , fill: color( i ) } , svg );
        const label = this.text( svg , x + 14 , height - 7 , s.label , { fill: pal.text } );
        x += 24 + s.label.length * 6.2;
        return label;
      } );
    }
    const cursor = this.node( "line" , { y1: pad.top , y2: pad.top + ph , stroke: pal.text , "stroke-opacity": 0.35 , visibility: "hidden" } , svg );
    return {
      svg: svg,
      geometry: {
        plotWidthPx: () => {
          const box = svg.getBoundingClientRect();
          return ( pw / width ) * ( box.width || width );
        },
        timeAt: ( event ) => {
          const box = svg.getBoundingClientRect();
          const px = ( ( event.clientX - box.left ) / ( box.width || width ) ) * width;
          return view.x0 + ( ( px - pad.left ) / pw ) * ( view.x1 - view.x0 );
        },
        cursor: ( x ) => {
          if ( x == null || x < view.x0 || x > view.x1 ) { cursor.setAttribute( "visibility" , "hidden" ); return; }
          cursor.setAttribute( "x1" , X( x ) );
          cursor.setAttribute( "x2" , X( x ) );
          cursor.setAttribute( "visibility" , "visible" );
        },
      },
    };
  },

  // -- bar chart ------------------------------------------------------------
  //
  // spec: { bars[{ label, value, sub? }], height, yLabel, format(v), color, light, title }
  bars( spec , width ) {
    const pal = this.palette( spec.light );
    const w = width || 640;
    const height = spec.height || 200;
    const pad = { left: 48 , right: 12 , top: spec.title ? 30 : 12 , bottom: 40 };
    const svg = this.svg( w , height , pal );
    if ( spec.title ) this.text( svg , pad.left , 18 , spec.title , { "font-size": 13 , "font-weight": 600 , fill: pal.text } );
    const pw = w - pad.left - pad.right;
    const ph = height - pad.top - pad.bottom;
    const max = Math.max( 1e-9 , ...spec.bars.map( ( b ) => b.value ) );
    const ystep = this.niceStep( max , 4 );
    const top = Math.ceil( max / ystep ) * ystep;
    const Y = ( v ) => pad.top + ( 1 - v / top ) * ph;
    for ( let y = 0; y <= top + 1e-9; y += ystep ) {
      this.node( "line" , { x1: pad.left , x2: pad.left + pw , y1: Y( y ) , y2: Y( y ) , stroke: y === 0 ? pal.axis : pal.grid } , svg );
      this.text( svg , pad.left - 6 , Y( y ) + 4 , ( spec.format || this.number )( y ) , { "text-anchor": "end" , fill: pal.muted } );
    }
    const slot = pw / Math.max( 1 , spec.bars.length );
    const bw = Math.max( 2 , Math.min( 48 , slot * 0.7 ) );
    const every = Math.max( 1 , Math.ceil( spec.bars.length / Math.max( 1 , Math.floor( pw / 44 ) ) ) );
    spec.bars.forEach( ( b , i ) => {
      const cx = pad.left + slot * ( i + 0.5 );
      const rect = this.node( "rect" , { x: cx - bw / 2 , y: Y( b.value ) , width: bw , height: Math.max( 0 , Y( 0 ) - Y( b.value ) ) , rx: 2 , fill: spec.color || pal.series[ 0 ] } , svg );
      this.node( "title" , {} , rect ).textContent = b.label + ": " + ( spec.format || this.number )( b.value );
      if ( i % every === 0 ) this.text( svg , cx , pad.top + ph + 15 , b.label , { "text-anchor": "middle" , fill: pal.muted , "font-size": 10 } );
    } );
    if ( spec.xLabel ) this.text( svg , pad.left + pw , height - 6 , spec.xLabel , { "text-anchor": "end" , fill: pal.muted , "font-size": 10 } );
    if ( spec.yLabel ) this.text( svg , pad.left , pad.top - 2 , spec.yLabel , { fill: pal.muted , "font-size": 10 } );
    return svg;
  },

  // -- export ---------------------------------------------------------------

  serialize( svg ) {
    return '<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLSerializer().serializeToString( svg );
  },

  // An SVG drawn onto a canvas at scale x its size, as a PNG Blob. The SVG
  // goes in as a data: URL, which the CSP allows (img-src 'self' data:).
  png( svg , scale ) {
    const k = scale || 3;
    const w = Number( svg.getAttribute( "width" ) );
    const h = Number( svg.getAttribute( "height" ) );
    return new Promise( ( resolve , reject ) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement( "canvas" );
        canvas.width = Math.round( w * k );
        canvas.height = Math.round( h * k );
        const ctx = canvas.getContext( "2d" );
        ctx.scale( k , k );
        ctx.drawImage( img , 0 , 0 , w , h );
        canvas.toBlob( ( blob ) => ( blob ? resolve( blob ) : reject( new Error( "png" ) ) ) , "image/png" );
      };
      img.onerror = () => reject( new Error( "png" ) );
      img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent( this.serialize( svg ) );
    } );
  },

  slug( text ) {
    return String( text || "figure" ).toLowerCase().replace( /[^a-z0-9]+/g , "-" ).replace( /^-+|-+$/g , "" ).slice( 0 , 60 ) || "figure";
  },

  // Download buttons for a figure. make(light) returns a fresh <svg>; the
  // download is always drawn in the light palette, whatever the page shows.
  downloads( make , filename ) {
    const name = this.slug( filename );
    return Dom.el( "div" , { class: "row-actions chart-downloads" , children: [
      Ui.button( I18n.get( "charts.download_svg" ) , "filetype-svg" , () => {
        Ui.download( name + ".svg" , new Blob( [ this.serialize( make( true ) ) ] , { type: "image/svg+xml" } ) );
      } , { small: true } ),
      Ui.button( I18n.get( "charts.download_png" ) , "file-image" , async () => {
        try {
          Ui.download( name + ".png" , await this.png( make( true ) ) );
        } catch ( error ) {
          Dom.toast( I18n.get( "charts.png_failed" ) , "error" );
        }
      } , { small: true } ),
    ] } );
  },

  // A static figure (an <svg> built by make(light, width)) with its
  // downloads. On screen it is drawn at the width there is; the download at
  // the figure's own width.
  figure( make , filename ) {
    const host = Dom.el( "div" , { class: "chart-host chart-figure" } );
    let lastWidth = 0;
    const draw = () => {
      lastWidth = host.clientWidth;
      host.replaceChildren( make( false , lastWidth || undefined ) );
    };
    new ResizeObserver( () => { if ( Math.abs( host.clientWidth - lastWidth ) >= 2 ) draw(); } ).observe( host );
    draw();
    return Dom.el( "div" , { class: "chart" , children: [ host , this.downloads( ( light ) => make( light ) , filename ) ] } );
  },
};
