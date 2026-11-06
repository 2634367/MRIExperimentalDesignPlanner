// What the design puts on screen, once each, and where. Two layers count as
// the same thing when they would look the same in the same place, so copies
// of a fixation cross made by hand show up as one row with a count.
//
// That is also how copies get linked to the design's fixation mark
// (Schema.fixationLayer): nothing is linked until someone asks, because a
// "+" on one screen is not always the same thing as a "+" on another.
const Inventory = {
  LONGEST_MARK: 12,

  // Every screen a participant can see: [{ where, layers }].
  screens( doc ) {
    const out = [];
    const named = ( thing , key ) => thing.name || I18n.get( key );
    doc.trial_types.forEach( ( tt ) => tt.phases.forEach( ( phase , index ) => {
      out.push( { where: named( tt , "trials.unnamed" ) + " › " + ( phase.name || I18n.get( "trials.phase" ) + " " + ( index + 1 ) ) , layers: phase.layers } );
    } ) );
    doc.runs.forEach( ( run ) => {
      const name = named( run , "runs.unnamed" );
      if ( run.instructions.enabled ) out.push( { where: name + " › " + I18n.get( "runs.instructions" ) , layers: run.instructions.layers } );
      [ [ run.lead_in , "runs.lead_in" ] , [ run.lead_out , "runs.lead_out" ] ].forEach( ( [ lead , key ] ) => {
        if ( lead.seconds > 0 || lead.jitter ) out.push( { where: name + " › " + I18n.get( key ) , layers: lead.layers } );
      } );
      run.blocks.forEach( ( block ) => {
        if ( block.rest_after.seconds > 0 ) out.push( { where: name + " › " + I18n.get( "runs.rest" ) , layers: block.rest_after.layers } );
      } );
    } );
    return out;
  },

  // Equal for layers that look the same in the same place. Ids and the
  // wrapping of a line too short to wrap do not count.
  signature( layer ) {
    if ( layer.kind === "fixation" ) return "fixation";
    const place = layer.pos.join( "," );
    if ( layer.kind === "text" ) return [ "text" , layer.text , layer.height , layer.color , layer.bold , place ].join( "|" );
    if ( layer.kind === "image" ) return [ "image" , layer.media , layer.height , layer.fit , place ].join( "|" );
    return [ "shape" , layer.shape , layer.shape === "polygon" ? layer.sides : "" , layer.size , layer.color , layer.fill , layer.ori , place ].join( "|" );
  },

  // Layers that draw nothing are not on screen.
  blank( layer ) {
    return ( layer.kind === "text" && !layer.text.trim() ) || ( layer.kind === "image" && !layer.media );
  },

  // [{ signature, layer, places[], count }], commonest first.
  rows( doc ) {
    const rows = new Map();
    this.screens( doc ).forEach( ( screen ) => screen.layers.forEach( ( layer ) => {
      if ( this.blank( layer ) ) return;
      const signature = this.signature( layer );
      if ( !rows.has( signature ) ) rows.set( signature , { signature: signature , layer: layer , places: [] , count: 0 } );
      const row = rows.get( signature );
      row.count += 1;
      if ( !row.places.includes( screen.where ) ) row.places.push( screen.where );
    } ) );
    return Array.from( rows.values() ).sort( ( a , b ) => b.count - a.count );
  },

  // A template differs item by item, so it cannot be one shared mark, and a
  // sentence of instructions is not a mark at all.
  linkable( layer ) {
    if ( layer.kind === "fixation" ) return false;
    if ( layer.kind === "text" && layer.text.length > this.LONGEST_MARK ) return false;
    return !/\{[a-z_][a-z0-9_]*\}/.test( layer.kind === "text" ? layer.text : layer.kind === "image" ? layer.media : "" );
  },

  // Every copy of signature in this document becomes the mark.
  link( doc , signature ) {
    this.screens( doc ).forEach( ( screen ) => screen.layers.forEach( ( layer , index ) => {
      if ( this.signature( layer ) === signature ) screen.layers[ index ] = Schema.fixationLayer();
    } ) );
  },

  // That layer becomes the mark, and its copies show it.
  adopt( doc , signature ) {
    const row = this.rows( doc ).find( ( r ) => r.signature === signature );
    if ( !row ) return;
    doc.fixation.layers = [ Object.assign( JSON.parse( JSON.stringify( row.layer ) ) , { id: Schema.uid( "l" ) } ) ];
    this.link( doc , signature );
  },

  describe( doc , layer ) {
    if ( layer.kind === "fixation" ) return doc.fixation.layers.map( ( mark ) => this.describe( doc , mark ) ).join( " " );
    if ( layer.kind === "text" ) return layer.text.replace( /\s+/g , " " ).slice( 0 , 80 );
    if ( layer.kind === "image" ) {
      const entry = doc.media.find( ( m ) => m.id === layer.media );
      return entry ? entry.name : layer.media;
    }
    return I18n.get( "layers.shape_" + layer.shape );
  },

  size( layer ) {
    if ( layer.kind === "fixation" ) return "";
    return layer.kind === "shape" ? layer.size : layer.kind === "image" && layer.fit ? I18n.get( "layers.full_size" ) : layer.height;
  },

  // For the report.
  table( doc ) {
    return {
      id: "on-screen" , title: Tables.t( "on_screen_title" ),
      columns: [ Tables.t( "shown" ) , Tables.t( "kind" ) , Tables.t( "size" ) , Tables.t( "color" ) , Tables.t( "uses" ) , Tables.t( "where" ) ],
      rows: this.rows( doc ).map( ( row ) => [
        this.describe( doc , row.layer ) , I18n.get( "layers.kind_" + row.layer.kind ) , this.size( row.layer ) , row.layer.color || "" , row.count , row.places.join( "; " ).slice( 0 , 1900 ),
      ] ),
    };
  },

  // The card on Scanner & display.
  section( doc ) {
    const rows = this.rows( doc );
    if ( !rows.length ) return Ui.section( Ui.t( "settings.on_screen" ) , [ Ui.muted( Ui.t( "settings.on_screen_none" ) ) ] );
    const SHOWN_PLACES = 3;
    const table = Dom.el( "table" , { class: "table table-sm align-middle" } );
    table.appendChild( Dom.el( "thead" , { children: [ Dom.el( "tr" , { children: [
      Dom.el( "th" , { text: Ui.t( "settings.on_screen_shown" ) } ),
      Dom.el( "th" , { text: Ui.t( "settings.on_screen_size" ) } ),
      Dom.el( "th" , { class: "text-end" , text: Tables.t( "uses" ) } ),
      Dom.el( "th" , { text: Ui.t( "settings.on_screen_where" ) } ),
      Dom.el( "th" ),
    ] } ) ] } ) );
    const body = Dom.el( "tbody" );
    rows.forEach( ( row ) => {
      const shown = Dom.el( "td" , { children: [ Dom.el( "span" , { class: "small text-body-secondary me-2" , text: I18n.get( "layers.kind_" + row.layer.kind ) } ) , Dom.el( "span" , { text: this.describe( doc , row.layer ) } ) ] } );
      const places = row.places.slice( 0 , SHOWN_PLACES ).join( ", " ) + ( row.places.length > SHOWN_PLACES ? " " + Ui.t( "settings.on_screen_more" ).replace( "{n}" , row.places.length - SHOWN_PLACES ) : "" );
      const actions = Dom.el( "td" , { class: "text-end" } );
      if ( this.linkable( row.layer ) ) {
        const wrap = Dom.el( "div" , { class: "row-actions justify-content-end flex-nowrap" } );
        wrap.appendChild( Ui.button( Ui.t( "settings.on_screen_link" ) , "link-45deg" , () => Doc.change( Ui.t( "undo.fixation_linked" ) , ( d ) => this.link( d , row.signature ) ) , { small: true , editOnly: true , class: "text-nowrap" , title: Ui.t( "settings.on_screen_link_title" ).replace( "{n}" , row.count ) } ) );
        wrap.appendChild( Ui.button( Ui.t( "settings.on_screen_adopt" ) , "bullseye" , () => Doc.change( Ui.t( "undo.fixation_linked" ) , ( d ) => this.adopt( d , row.signature ) ) , { small: true , editOnly: true , class: "text-nowrap" , title: Ui.t( "settings.on_screen_adopt_title" ).replace( "{n}" , row.count ) } ) );
        actions.appendChild( wrap );
      }
      body.appendChild( Dom.el( "tr" , { children: [
        shown,
        Dom.el( "td" , { class: "small" , text: String( this.size( row.layer ) ) } ),
        Dom.el( "td" , { class: "text-end" , text: String( row.count ) } ),
        Dom.el( "td" , { class: "small text-body-secondary" , text: places , attrs: { title: row.places.join( ", " ) } } ),
        actions,
      ] } ) );
    } );
    table.appendChild( body );
    return Ui.section( Ui.t( "settings.on_screen" ) , [ Dom.el( "div" , { class: "table-responsive" , children: [ table ] } ) ] , { help: Ui.t( "settings.on_screen_help" ) } );
  },
};
