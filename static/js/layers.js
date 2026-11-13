// The editor for one screen's layers: text, pictures, shapes, stacked in
// order (later layers draw on top). Used for trial phases (trials.js) and for
// a run's instructions, lead-in, lead-out and rests (runs.js).
//
// A text or picture value can be a literal or "{column}" from the trial's
// prompt list; the column chips insert one. Outside a trial (a run's
// lead-in, say) there is no prompt item, so no chips are offered.
//
//   LayerEditor.render( { layers , list , key , edit , mark } )
//     edit( label , fn ) applies fn( layersArrayInTheDocument ) through
//     Doc.change -- the caller knows where these layers live. mark says these
//     are the fixation mark's own layers, which cannot show the mark.
//
// A "fixation" layer has nothing to set: it shows the design's fixation mark
// (Scanner & display), so changing the mark changes every screen that has one.
const LayerEditor = {
  render( options ) {
    const { layers , list , key , edit } = options;
    const root = Dom.el( "div" , { class: "layer-editor" } );
    if ( !layers.length ) root.appendChild( Ui.muted( Ui.t( "layers.none" ) ) );
    layers.forEach( ( layer , index ) => root.appendChild( this.layerRow( layer , index , layers.length , list , key + ".l" + layer.id , edit ) ) );
    if ( !Ui.readOnly() ) {
      const add = Dom.el( "div" , { class: "row-actions mt-2" } );
      const adder = ( text , icon , make ) => Ui.button( text , icon , () => edit( Ui.t( "undo.layer_added" ) , ( arr ) => arr.push( make() ) ) , { small: true } );
      add.appendChild( adder( Ui.t( "layers.add_text" ) , "fonts" , () => Schema.textLayer( list && list.columns.length ? "{" + list.columns[ 0 ].key + "}" : "" ) ) );
      add.appendChild( adder( Ui.t( "layers.add_image" ) , "image" , () => {
        const column = list && list.columns.find( ( c ) => c.type === "image" );
        return Schema.imageLayer( column ? "{" + column.key + "}" : "" );
      } ) );
      add.appendChild( adder( Ui.t( "layers.add_shape" ) , "triangle" , () => Schema.shapeLayer( "circle" ) ) );
      if ( !options.mark ) add.appendChild( adder( Ui.t( "layers.add_fixation" ) , "plus-lg" , () => Schema.fixationLayer() ) );
      root.appendChild( add );
    }
    return root;
  },

  layerRow( layer , index , count , list , key , edit ) {
    const change = ( label , fn , merge ) => edit( label , ( arr ) => {
      const target = arr.find( ( l ) => l.id === layer.id );
      if ( target ) fn( target , arr );
    } , merge );
    const set = ( field ) => ( value ) => change( Ui.t( "undo.layer_changed" ) , ( l ) => { l[ field ] = value; } );
    const kindIcon = { text: "fonts" , image: "image" , shape: "triangle" , fixation: "plus-lg" }[ layer.kind ];
    const head = Dom.el( "div" , { class: "d-flex align-items-center gap-2 mb-2" , children: [
      Dom.el( "i" , { class: "bi bi-" + kindIcon , attrs: { "aria-hidden": "true" } } ),
      Dom.el( "strong" , { class: "small flex-grow-1" , text: Ui.t( "layers.kind_" + layer.kind ) } ),
    ] } );
    if ( !Ui.readOnly() ) {
      head.appendChild( Ui.icon( "arrow-up" , Ui.t( "ui.move_up" ) , () => change( Ui.t( "undo.layer_moved" ) , ( l , arr ) => Ui.move( arr , arr.indexOf( l ) , -1 ) ) , { disabled: index === 0 } ) );
      head.appendChild( Ui.icon( "arrow-down" , Ui.t( "ui.move_down" ) , () => change( Ui.t( "undo.layer_moved" ) , ( l , arr ) => Ui.move( arr , arr.indexOf( l ) , 1 ) ) ) );
      head.appendChild( Ui.icon( "files" , Ui.t( "ui.duplicate" ) , () => change( Ui.t( "undo.layer_added" ) , ( l , arr ) => {
        const copy = JSON.parse( JSON.stringify( l ) );
        copy.id = Schema.uid( "l" );
        arr.splice( arr.indexOf( l ) + 1 , 0 , copy );
      } ) ) );
      head.appendChild( Ui.icon( "trash" , Ui.t( "ui.delete" ) , () => change( Ui.t( "undo.layer_deleted" ) , ( l , arr ) => arr.splice( arr.indexOf( l ) , 1 ) ) , { variant: "btn-outline-danger" } ) );
    }

    if ( layer.kind === "fixation" ) {
      return Dom.el( "div" , { class: "layer-row" , children: [ head , Dom.el( "a" , { class: "small" , text: Ui.t( "layers.fixation_link" ) , attrs: { href: Nav.url( "settings" ) } } ) ] } );
    }

    // Every setting gets the same cell, so labels and inputs line up in
    // columns whatever mix of settings a layer has. The card's own width (a
    // container query, .layer-cell in designer.css) picks two, three or six
    // across -- the editor sits beside a preview, so the screen width says
    // little. Text and pictures span the row.
    const cell = "col-6 layer-cell";
    const num = ( labelKey , value , commit , extra ) => Ui.field( labelKey , Ui.number( value , commit , Object.assign( { small: true } , extra ) ) , { col: cell } );
    const tick = ( value , labelKey , commit , k ) => Dom.el( "div" , { class: cell , children: [ Ui.check( value , Ui.t( labelKey ) , commit , { key: k } ) ] } );
    const colour = () => Ui.field( "layers.color" , Ui.color( layer.color , set( "color" ) , { allowEmpty: true , small: true , key: key + ".c" } ) , { col: cell } );
    // Full sized pictures are centred by compile, so they have no position.
    const position = layer.kind === "image" && layer.fit ? [] : [
      num( "layers.x" , layer.pos[ 0 ] , ( v ) => change( Ui.t( "undo.layer_changed" ) , ( l ) => { l.pos = [ v , l.pos[ 1 ] ]; } ) , { key: key + ".x" , step: 0.05 } ),
      num( "layers.y" , layer.pos[ 1 ] , ( v ) => change( Ui.t( "undo.layer_changed" ) , ( l ) => { l.pos = [ l.pos[ 0 ] , v ]; } ) , { key: key + ".y" , step: 0.05 } ),
    ];

    const fields = [];
    if ( layer.kind === "text" ) {
      // A textarea, so line breaks (instructions) survive editing.
      const input = Ui.textarea( layer.text , set( "text" ) , { key: key + ".text" , placeholder: Ui.t( "layers.text_placeholder" ) , rows: Math.min( 8 , Math.max( 1 , layer.text.split( "\n" ).length ) ) } );
      fields.push( Ui.field( "layers.text" , input , { col: "col-12" } ) );
      if ( list ) fields.push( Dom.el( "div" , { class: "col-12" , children: [ this.chips( list , "text" , ( token ) => set( "text" )( ( layer.text || "" ) + token ) ) ] } ) );
      fields.push( num( "layers.height" , layer.height , set( "height" ) , { key: key + ".h" , min: 0.001 , step: 0.01 } ) );
      fields.push( num( "layers.wrap" , layer.wrap , set( "wrap" ) , { key: key + ".w" , min: 0.05 , step: 0.1 } ) );
      fields.push( colour() , tick( layer.bold , "layers.bold" , set( "bold" ) , key + ".b" ) , ...position );
    } else if ( layer.kind === "image" ) {
      fields.push( Ui.field( "layers.picture" , this.pictureSource( layer , list , set( "media" ) , key ) , { col: "col-12" } ) );
      if ( !layer.fit ) fields.push( num( "layers.height" , layer.height , set( "height" ) , { key: key + ".h" , min: 0.01 , step: 0.05 } ) );
      fields.push( tick( layer.fit , "layers.full_size" , set( "fit" ) , key + ".fit" ) , ...position );
    } else {
      fields.push( Ui.field( "layers.shape" , Ui.select( layer.shape , Schema.SHAPES.map( ( s ) => [ s , Ui.t( "layers.shape_" + s ) ] ) , set( "shape" ) , { small: true , key: key + ".s" } ) , { col: cell } ) );
      if ( layer.shape === "polygon" ) fields.push( num( "layers.sides" , layer.sides , set( "sides" ) , { key: key + ".n" , min: 3 , max: 64 , step: 1 } ) );
      fields.push( num( "layers.size" , layer.size , set( "size" ) , { key: key + ".z" , min: 0.001 , step: 0.01 } ) );
      fields.push( num( "layers.rotation" , layer.ori , set( "ori" ) , { key: key + ".o" , min: -360 , max: 360 , step: 5 } ) );
      fields.push( colour() , tick( layer.fill , "layers.filled" , set( "fill" ) , key + ".f" ) , ...position );
    }
    return Dom.el( "div" , { class: "layer-row" , children: [ head , Ui.row( fields ) ] } );
  },

  // Buttons that insert {column} for each column of a type.
  chips( list , type , insert ) {
    const wrap = Dom.el( "div" , { class: "chip-row" } );
    const columns = list.columns.filter( ( c ) => type === "text" ? c.type !== "image" : c.type === "image" );
    if ( !columns.length ) return wrap;
    wrap.appendChild( Dom.el( "span" , { class: "small text-body-secondary me-1" , text: Ui.t( "layers.insert_column" ) } ) );
    columns.forEach( ( c ) => {
      const chip = Dom.el( "button" , { class: "btn btn-sm btn-light chip" , text: "{" + c.key + "}" , attrs: { type: "button" , title: c.label } } );
      chip.disabled = Ui.readOnly();
      chip.addEventListener( "click" , () => insert( "{" + c.key + "}" ) );
      wrap.appendChild( chip );
    } );
    return wrap;
  },

  // A picture: one from the library, or the item's image column.
  pictureSource( layer , list , commit , key ) {
    const wrap = Dom.el( "div" , { class: "d-flex gap-2 align-items-center flex-wrap" } );
    const options = [ [ "" , Ui.t( "layers.picture_none" ) ] ];
    if ( list ) list.columns.filter( ( c ) => c.type === "image" ).forEach( ( c ) => options.push( [ "{" + c.key + "}" , Ui.t( "layers.picture_column" ) + " {" + c.key + "}" ] ) );
    const fixed = layer.media && !layer.media.includes( "{" );
    if ( fixed ) {
      const entry = Doc.doc.media.find( ( m ) => m.id === layer.media );
      options.push( [ layer.media , entry ? entry.name : Ui.t( "layers.picture_missing" ) ] );
    }
    if ( layer.media.includes( "{" ) && !options.some( ( o ) => o[ 0 ] === layer.media ) ) options.push( [ layer.media , layer.media ] );
    wrap.appendChild( Ui.select( layer.media , options , commit , { small: true , key: key + ".m" } ) );
    if ( fixed ) {
      const thumb = Dom.el( "img" , { class: "thumb-sm" , attrs: { alt: "" } } );
      thumb.src = Doc.mediaUrl( layer.media );
      wrap.appendChild( thumb );
    }
    wrap.appendChild( Ui.button( Ui.t( "layers.choose_picture" ) , "images" , async () => {
      const sha = await MediaLibrary.pick();
      if ( sha ) commit( sha );
    } , { small: true , editOnly: true } ) );
    return wrap;
  },
};
