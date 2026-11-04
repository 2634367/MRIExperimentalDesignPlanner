// The Runs screen. A run is what happens between pressing start on the
// scanner and it stopping: optional instructions (shown before the trigger),
// a lead-in, blocks of trials, rests between blocks, and a lead-out.
//
// A block is a mix of trial types -- 10 of these, 10 of those -- shown
// shuffled, in the order listed, or alternating, and repeated as many times
// as you like. Everything the run shows is on its single timeline, so its
// length here is its length in the scanner.
const Runs = {
  name: "runs",
  selected: null,

  current() {
    const all = Doc.doc.runs;
    if ( !all.some( ( r ) => r.id === this.selected ) ) this.selected = all.length ? all[ 0 ].id : null;
    return all.find( ( r ) => r.id === this.selected ) || null;
  },

  focus( id ) {
    this.selected = id;
  },

  edit( label , fn , options ) {
    const id = this.selected;
    Doc.change( label , ( d ) => {
      const run = d.runs.find( ( r ) => r.id === id );
      if ( run ) fn( run , d );
    } , options );
  },

  render( root ) {
    const doc = Doc.doc;
    root.replaceChildren();
    root.appendChild( Ui.muted( Ui.t( "runs.description" ) ) );
    const run = this.current();
    const add = Ui.button( Ui.t( "runs.new" ) , "plus-lg" , () => {
      const fresh = Schema.run( Doc.nextName( "runs" , "runs.default_name" ) , doc.trial_types.length ? doc.trial_types[ 0 ].id : "" );
      Doc.change( Ui.t( "undo.run_added" ) , ( d ) => d.runs.push( fresh ) );
      this.selected = fresh.id;
      Designer.refresh();
    } , { variant: "btn-outline-primary" , small: true , editOnly: true } );
    // A compact row of chips above the editor, which gets the full width.
    root.appendChild( Ui.picker( doc.runs.map( ( r ) => ( { id: r.id , name: r.name , meta: Timing.clock( Timing.run( doc , r ).total.mean ) } ) ) , this.selected , ( id ) => {
      this.selected = id;
      Designer.refresh();
    } , { unnamed: Ui.t( "runs.unnamed" ) , chips: true , add: add } ) );
    root.appendChild( run ? this.editor( run ) : Ui.empty( Ui.t( "runs.none" ) ) );
  },

  editor( run ) {
    const doc = Doc.doc;
    const info = Timing.run( doc , run );
    const usedBy = Validate.usages( doc , "run" , run.id );
    const box = Dom.el( "div" );
    const about = [];
    about.push( Ui.row( [
      Ui.field( "runs.name" , Ui.text( run.name , ( v ) => this.edit( Ui.t( "undo.run_renamed" ) , ( r ) => { r.name = v.trim(); } ) , { key: "run.name" } ) , { col: "col-md-5" } ),
      Ui.field( "runs.notes" , Ui.text( run.notes , ( v ) => this.edit( Ui.t( "undo.run_changed" ) , ( r ) => { r.notes = v; } ) , { key: "run.notes" } ) , { col: "col-md" } ),
    ] ) );
    const card = Scanners.select( run.card ? run.card.id : "" , Ui.t( "scanners.none_run" ) , ( v ) => this.edit( Ui.t( "undo.card_linked" ) , ( r ) => {
      const picked = Scanners.byId( v );
      r.card = picked ? Scanners.ref( picked ) : null;
      if ( r.card && r.card.tr > 0 ) r.tr = r.card.tr;
    } ) , { key: "run.card" } );
    const tr = Ui.number( run.tr || "" , ( v ) => this.edit( Ui.t( "undo.run_changed" ) , ( r ) => { r.tr = Math.max( 0 , v || 0 ); } ) , { key: "run.tr" , min: 0 , step: 0.05 , placeholder: String( doc.scanner.tr ) , disabled: Boolean( run.card && run.card.tr > 0 ) } );
    about.push( Ui.row( [
      Ui.field( "scanners.run_card" , card , { col: "col-md-6" , help: Ui.t( "scanners.run_card_help" ) } ),
      Ui.field( "runs.tr" , tr , { col: "col-6 col-md-3" , help: Ui.t( "runs.tr_help" ) } ),
      Ui.field( "runs.dummy" , Ui.number( run.dummy_volumes >= 0 ? run.dummy_volumes : "" , ( v , input ) => this.edit( Ui.t( "undo.run_changed" ) , ( r ) => { r.dummy_volumes = input.value === "" ? -1 : Math.max( 0 , Math.round( v ) ); } ) , { key: "run.dummy" , min: 0 , step: 1 , placeholder: String( doc.scanner.dummy_volumes ) } ) , { col: "col-6 col-md-3" , help: Ui.t( "runs.dummy_help" ) } ),
    ] , "mt-1" ) );
    if ( Scanners.stale( run.card ) ) about.push( this.updateFromCard( run ) );
    if ( usedBy.length ) about.push( Ui.muted( Ui.t( "runs.used_by" ) + " " + usedBy.join( ", " ) , "mt-2" ) );
    box.appendChild( Ui.section( Ui.t( "runs.section_run" ) , about , { fold: "runs.about" } ) );

    // The numbers that matter at the console.
    const stats = Dom.el( "div" , { class: "stat-row" } );
    const stat = ( label , value , sub ) => stats.appendChild( Dom.el( "div" , { class: "stat" , children: [
      Dom.el( "div" , { class: "stat-label" , text: label } ), Dom.el( "div" , { class: "stat-value" , text: value } ),
      sub ? Dom.el( "div" , { class: "stat-sub" , text: sub } ) : Dom.el( "span" ),
    ] } ) );
    stat( Ui.t( "runs.stat_trials" ) , String( info.trials ) , Object.keys( info.counts ).map( ( id ) => ( Timing.trialTypeById( doc , id ) || {} ).name + " " + info.counts[ id ] ).join( " · " ) );
    stat( Ui.t( "runs.stat_length" ) , Timing.clock( info.total.mean ) , info.total.max > info.total.min ? Timing.clock( info.total.min ) + "–" + Timing.clock( info.total.max ) : Ui.t( "runs.stat_fixed" ) );
    stat( Ui.t( "runs.stat_volumes" ) , info.volumes.min === info.volumes.max ? String( info.volumes.max ) : info.volumes.min + "–" + info.volumes.max , Ui.t( "runs.stat_volumes_sub" ).replace( "{tr}" , info.tr ).replace( "{dummy}" , info.dummy ) );
    const play = Ui.button( Ui.t( "run.play_run" ) , "play-fill" , () => RunDialog.open( {
      title: run.name || Ui.t( "runs.unnamed" ) , kind: "run",
      build: ( options ) => Compile.runPlans( Doc.doc , { id: Doc.id } , run.id , options ),
    } ) , { variant: "btn-primary" , small: true } );
    box.appendChild( Ui.section( Ui.t( "runs.section_timeline" ) , [
      stats, this.timeline( run , info ), Tables.actions( () => Tables.runOutline( Doc.doc , run ) ),
    ] , { actions: [ play ] , fold: "runs.timeline" } ) );

    // Before the trials.
    const instructions = [ Ui.check( run.instructions.enabled , Ui.t( "runs.instructions_enabled" ) , ( v ) => this.edit( Ui.t( "undo.run_changed" ) , ( r ) => { r.instructions.enabled = v; } ) , { key: "run.instr" } ) ];
    if ( run.instructions.enabled ) {
      instructions.push( this.screenEditor( run.instructions , "run.instr" , ( label , fn ) => this.edit( label , ( r ) => fn( r.instructions ) ) , false ) );
    }
    box.appendChild( Ui.section( Ui.t( "runs.instructions" ) , instructions , { fold: "runs.instructions" } ) );
    box.appendChild( Ui.section( Ui.t( "runs.lead_in" ) , this.screenEditor( run.lead_in , "run.leadin" , ( label , fn ) => this.edit( label , ( r ) => fn( r.lead_in ) ) , true ) , { fold: "runs.leadin" } ) );

    // Blocks.
    const addBlock = Ui.button( Ui.t( "runs.add_block" ) , "plus-lg" , () => this.edit( Ui.t( "undo.block_added" ) , ( r , d ) => {
      r.blocks.push( Schema.block( d.trial_types.length ? d.trial_types[ 0 ].id : "" ) );
    } ) , { variant: "btn-outline-primary" , small: true , editOnly: true } );
    box.appendChild( Ui.section( Ui.t( "runs.blocks" ) + " (" + run.blocks.length + ")" , run.blocks.length ? run.blocks.map( ( block , index ) => this.blockCard( run , block , index , info ) ) : Ui.empty( Ui.t( "runs.no_blocks" ) ) , { actions: [ addBlock ] , fold: "runs.blocks" } ) );

    box.appendChild( Ui.section( Ui.t( "runs.lead_out" ) , this.screenEditor( run.lead_out , "run.leadout" , ( label , fn ) => this.edit( label , ( r ) => fn( r.lead_out ) ) , true ) , { fold: "runs.leadout" } ) );

    box.appendChild( this.efficiency( run ) );
    box.appendChild( Ui.section( Ui.t( "figures.heading" ) , Charts.figure( ( light , width ) => Figures.run( Doc.doc , run , light , width ) , "run-" + ( run.name || run.id ) ) , { fold: "runs.figure" } ) );

    const footer = Dom.el( "div" , { class: "row-actions mt-3" } );
    footer.appendChild( Ui.button( Ui.t( "ui.duplicate" ) , "files" , () => {
      const copy = JSON.parse( JSON.stringify( run ) );
      copy.id = Schema.uid( "run" );
      copy.name = ( run.name || Ui.t( "runs.unnamed" ) ) + " " + Ui.t( "ui.copy_suffix" );
      copy.blocks.forEach( ( b ) => { b.id = Schema.uid( "b" ); } );
      Doc.change( Ui.t( "undo.run_added" ) , ( d ) => d.runs.push( copy ) );
      this.selected = copy.id;
      Designer.refresh();
    } , { editOnly: true } ) );
    footer.appendChild( Ui.button( Ui.t( "ui.delete" ) , "trash" , () => {
      if ( usedBy.length ) {
        Dom.toast( Ui.t( "runs.still_used" ) + " " + usedBy.join( ", " ) , "error" );
        return;
      }
      Doc.change( Ui.t( "undo.run_deleted" ) , ( d ) => { d.runs = d.runs.filter( ( r ) => r.id !== run.id ); } , { toast: true } );
    } , { variant: "btn-outline-danger" , editOnly: true } ) );
    box.appendChild( footer );
    return box;
  },

  // How well this run lets each modelled phase be estimated, on one draw of
  // it (the seed picks the draw; Re-draw tries another).
  seeds: {},
  efficiency( run ) {
    const doc = Doc.doc;
    const box = Ui.section( Ui.t( "efficiency.heading" ) , [] , { help: Ui.t( "efficiency.help" ) , fold: "runs.efficiency" } );
    const body = box.querySelector( ".card-body" );
    if ( !Efficiency.regressors( doc ).length ) {
      body.appendChild( Ui.empty( Ui.t( "efficiency.none_modelled" ) ) );
      return box;
    }
    const seed = this.seeds[ run.id ] == null ? 1 : this.seeds[ run.id ];
    let result;
    try {
      result = Efficiency.run( doc , run , seed );
    } catch ( error ) {
      body.appendChild( Ui.empty( Ui.t( "efficiency.failed" ) ) );
      return box;
    }
    if ( !result.regressors.length ) {
      body.appendChild( Ui.empty( Ui.t( "efficiency.none_in_run" ) ) );
      return box;
    }
    const stats = Dom.el( "div" , { class: "stat-row mb-3" } );
    const stat = ( label , value , sub , tone ) => stats.appendChild( Dom.el( "div" , { class: "stat" + ( tone ? " stat-" + tone : "" ) , children: [
      Dom.el( "div" , { class: "stat-label" , text: label } ), Dom.el( "div" , { class: "stat-value" , text: value } ),
      Dom.el( "div" , { class: "stat-sub" , text: sub || "" } ),
    ] } ) );
    const baseline = result.contrasts.filter( ( c ) => !c.vs );
    const diffs = result.contrasts.filter( ( c ) => c.vs );
    stat( Ui.t( "efficiency.vs_baseline" ) , Efficiency.format( Math.min( ...baseline.map( ( c ) => c.efficiency ) ) ) , Ui.t( "efficiency.lowest_of" ).replace( "{n}" , baseline.length ) );
    if ( diffs.length ) stat( Ui.t( "efficiency.between" ) , Efficiency.format( Math.min( ...diffs.map( ( c ) => c.efficiency ) ) ) , Ui.t( "efficiency.lowest_of" ).replace( "{n}" , diffs.length ) );
    if ( result.maxCorrelation != null ) stat( Ui.t( "efficiency.max_r" ) , result.maxCorrelation.toFixed( 2 ) , Ui.t( "efficiency.max_r_sub" ) , result.maxCorrelation > 0.8 ? "warn" : "" );
    if ( result.maxVif != null ) stat( Ui.t( "efficiency.max_vif" ) , Number.isFinite( result.maxVif ) ? result.maxVif.toFixed( 2 ) : "∞" , Ui.t( "efficiency.max_vif_sub" ) , result.maxVif > 5 ? "warn" : "" );
    stat( Ui.t( "efficiency.single_trial" ) , Efficiency.format( result.singleTrial ) , Ui.t( "efficiency.single_trial_sub" ) );
    stat( Ui.t( "efficiency.duty" ) , Math.round( result.duty * 100 ) + "%" , Ui.t( "efficiency.duty_sub" ).replace( "{volumes}" , result.volumes ) );
    body.appendChild( stats );

    const seedInput = Ui.number( seed , ( v ) => { this.seeds[ run.id ] = Math.max( 0 , Math.round( v ) ); Designer.repaint( this.name ); } , { key: "run.effseed" , min: 0 , step: 1 , small: true } );
    seedInput.disabled = false;
    seedInput.classList.add( "report-seed" );
    const spec = this.efficiencySpec( result , run );
    spec.key = "eff." + run.id + "." + seed;
    spec.hideKey = "eff." + run.id;
    spec.buttons = [ { text: Ui.t( "efficiency.first_trials" ) , icon: "skip-start" , run: ( view , full ) => { view.x0 = full[ 0 ]; view.x1 = Math.min( full[ 1 ] , full[ 0 ] + 60 ); } } ];
    const plot = Charts.linePlot( spec );
    body.appendChild( plot.element );
    body.appendChild( Dom.el( "div" , { class: "row-actions align-items-center mt-1" , children: [
      Dom.el( "span" , { class: "small text-body-secondary" , text: Ui.t( "efficiency.seed" ) } ),
      seedInput,
      Ui.button( Ui.t( "efficiency.redraw" ) , "shuffle" , () => { this.seeds[ run.id ] = Compile.newSeed(); Designer.repaint( this.name ); } , { small: true } ),
      Charts.downloads( ( light ) => plot.svg( light ) , "efficiency-" + ( run.name || run.id ) ),
    ] } ) );
    body.appendChild( Ui.heading( Ui.t( "efficiency.contrasts" ) , 4 , "mt-3" ) );
    body.appendChild( Tables.view( Tables.efficiency( result , run ) ) );
    if ( result.regressors.length > 1 ) {
      body.appendChild( Ui.heading( Ui.t( "efficiency.correlations" ) , 4 , "mt-3" ) );
      body.appendChild( Tables.view( Tables.correlations( result , run ) , { toggle: plot } ) );
    }
    return box;
  },

  // The regressors over the run, with each modelled event shaded.
  efficiencySpec( result , run ) {
    return {
      t: result.series.t , height: 280 , zoom: true , legend: true ,
      title: Ui.t( "efficiency.plot_title" ).replace( "{name}" , run.name || "" ),
      series: result.regressors.map( ( reg , i ) => ( { label: reg.label , values: result.series.values[ i ] } ) ),
      bands: result.events.map( ( e ) => ( { x0: e.onset , x1: e.onset + e.duration , series: e.reg , opacity: 0.14 } ) ),
    };
  },

  // The run's card changed in the library since it was picked.
  updateFromCard( run ) {
    return Dom.el( "div" , { class: "mt-2" , children: [ Ui.button( Ui.t( "scanners.update" ) , "arrow-repeat" , () => this.edit( Ui.t( "undo.card_linked" ) , ( r ) => {
      const picked = Scanners.byId( r.card && r.card.id );
      if ( !picked ) return;
      r.card = Scanners.ref( picked );
      if ( r.card.tr > 0 ) r.tr = r.card.tr;
    } ) , { small: true , variant: "btn-outline-warning" , editOnly: true , title: Ui.t( "scanners.update_title" ) } ) ] } );
  },

  // Lead-in / lead-out / rest / instructions: seconds (unless untimed) and
  // what is on screen, with a preview.
  screenEditor( screen , key , edit , timed ) {
    const doc = Doc.doc;
    const wrap = Dom.el( "div" , { class: "row g-3" } );
    const left = Dom.el( "div" , { class: "col-xl-8" } );
    if ( timed ) {
      left.appendChild( Ui.row( [ Ui.field( "runs.seconds" , Ui.number( screen.seconds , ( v ) => edit( Ui.t( "undo.run_changed" ) , ( s ) => { s.seconds = Math.max( 0 , v ); } ) , { key: key + ".s" , min: 0 , step: 1 , small: true } ) , { col: "col-4 col-md-3" } ) ] ) );
    } else {
      left.appendChild( Ui.muted( Ui.t( "runs.instructions_help" ) ) );
    }
    left.appendChild( LayerEditor.render( { layers: screen.layers , list: null , key: key , edit: ( label , fn ) => edit( label , ( s ) => fn( s.layers ) ) } ) );
    const right = Dom.el( "div" , { class: "col-xl-4" } );
    const box = Display.screen( doc.display.aspect );
    Display.preview( box , doc , screen.layers , null , null , ( sha ) => Doc.mediaUrl( sha ) );
    right.appendChild( box );
    wrap.appendChild( left );
    wrap.appendChild( right );
    return wrap;
  },

  blockCard( run , block , index , info ) {
    const doc = Doc.doc;
    const key = "blk." + block.id;
    const editBlock = ( label , fn , options ) => this.edit( label , ( r ) => {
      const b = r.blocks.find( ( x ) => x.id === block.id );
      if ( b ) fn( b , r );
    } , options );
    const card = Dom.el( "div" , { class: "card mb-3" } );
    const body = Dom.el( "div" , { class: "card-body" } );
    const blockInfo = info.blocks.find( ( b ) => b.block.id === block.id );
    const head = Dom.el( "div" , { class: "d-flex gap-2 align-items-center flex-wrap" } );
    const inner = Dom.el( "div" );
    head.appendChild( Ui.folding( key , "" , [ inner ] , head ) );
    head.appendChild( Dom.el( "span" , { class: "phase-number" , text: String( index + 1 ) } ) );
    head.appendChild( Dom.el( "div" , { class: "flex-grow-1" , children: [ Ui.text( block.name , ( v ) => editBlock( Ui.t( "undo.block_changed" ) , ( b ) => { b.name = v.trim(); } ) , { key: key + ".name" , placeholder: Ui.t( "runs.block_name" ) } ) ] } ) );
    if ( !Doc.readOnly ) {
      head.appendChild( Ui.icon( "arrow-up" , Ui.t( "ui.move_up" ) , () => editBlock( Ui.t( "undo.block_moved" ) , ( b , r ) => Ui.move( r.blocks , r.blocks.indexOf( b ) , -1 ) ) , { disabled: index === 0 } ) );
      head.appendChild( Ui.icon( "arrow-down" , Ui.t( "ui.move_down" ) , () => editBlock( Ui.t( "undo.block_moved" ) , ( b , r ) => Ui.move( r.blocks , r.blocks.indexOf( b ) , 1 ) ) , { disabled: index === run.blocks.length - 1 } ) );
      head.appendChild( Ui.icon( "trash" , Ui.t( "ui.delete" ) , () => editBlock( Ui.t( "undo.block_deleted" ) , ( b , r ) => r.blocks.splice( r.blocks.indexOf( b ) , 1 ) , { toast: true } ) , { variant: "btn-outline-danger" } ) );
    }
    body.appendChild( head );
    inner.appendChild( Ui.row( [
      Ui.field( "runs.repeat" , Ui.number( block.repeat , ( v ) => editBlock( Ui.t( "undo.block_changed" ) , ( b ) => { b.repeat = Math.max( 1 , Math.round( v ) ); } ) , { key: key + ".rep" , min: 1 , step: 1 } ) , { col: "col-4 col-md-2" } ),
      Ui.field( "runs.order" , Ui.select( block.order , [ "shuffle" , "fixed" , "alternate" ].map( ( v ) => [ v , Ui.t( "runs.order_" + v ) ] ) , ( v ) => editBlock( Ui.t( "undo.block_changed" ) , ( b ) => { b.order = v; } ) , { key: key + ".order" } ) , { col: "col-8 col-md-4" } ),
      Dom.el( "div" , { class: "col-md form-row-text text-body-secondary small" , text: blockInfo ? Ui.t( "runs.block_summary" ).replace( "{trials}" , blockInfo.trials ).replace( "{time}" , Timing.clock( blockInfo.one.mean ) ) : "" } ),
    ] , "mt-2" ) );

    // The mix: "count × trial type" per line, the count wide enough for
    // three or four digits.
    const mix = Dom.el( "div" , { class: "mix-list mt-3 mb-2" } );
    if ( block.mix.length ) {
      mix.appendChild( Dom.el( "div" , { class: "mix-row mix-head small text-body-secondary" , children: [
        Dom.el( "span" , { text: Ui.t( "runs.mix_count" ) } ), Dom.el( "span" ), Dom.el( "span" , { text: Ui.t( "runs.mix_trial" ) } ), Dom.el( "span" ),
      ] } ) );
    }
    const typeOptions = doc.trial_types.map( ( tt ) => [ tt.id , tt.name || Ui.t( "trials.unnamed" ) ] );
    block.mix.forEach( ( entry , i ) => {
      const setEntry = ( fn ) => editBlock( Ui.t( "undo.block_changed" ) , ( b ) => { if ( b.mix[ i ] ) fn( b.mix[ i ] , b ); } );
      const options = typeOptions.some( ( o ) => o[ 0 ] === entry.trial_type ) ? typeOptions : [ [ entry.trial_type , Ui.t( "runs.missing_trial" ) ] ].concat( typeOptions );
      const count = Ui.number( entry.count , ( v ) => setEntry( ( e ) => { e.count = Math.max( 0 , Math.round( v ) ); } ) , { key: key + ".n" + i , min: 0 , step: 1 } );
      count.setAttribute( "aria-label" , Ui.t( "runs.mix_count" ) );
      const type = Ui.select( entry.trial_type , options , ( v ) => setEntry( ( e ) => { e.trial_type = v; } ) , { key: key + ".t" + i } );
      type.setAttribute( "aria-label" , Ui.t( "runs.mix_trial" ) );
      mix.appendChild( Dom.el( "div" , { class: "mix-row" , children: [
        count,
        Dom.el( "span" , { class: "text-body-secondary" , text: "×" } ),
        type,
        Doc.readOnly ? Dom.el( "span" ) : Ui.icon( "x-lg" , Ui.t( "ui.remove" ) , () => editBlock( Ui.t( "undo.block_changed" ) , ( b ) => b.mix.splice( i , 1 ) ) ),
      ] } ) );
    } );
    inner.appendChild( mix );
    inner.appendChild( Ui.button( Ui.t( "runs.add_mix" ) , "plus" , () => editBlock( Ui.t( "undo.block_changed" ) , ( b , r ) => {
      b.mix.push( { trial_type: doc.trial_types.length ? doc.trial_types[ 0 ].id : "" , count: 10 } );
    } ) , { small: true , editOnly: true , disabled: !doc.trial_types.length } ) );

    // Rest after.
    const rest = Dom.el( "details" , { class: "mt-3" } );
    rest.open = block.rest_after.seconds > 0;
    rest.appendChild( Dom.el( "summary" , { class: "small" , text: Ui.t( "runs.rest" ) + ( block.rest_after.seconds > 0 ? " · " + block.rest_after.seconds + " s" : " · " + Ui.t( "runs.rest_none" ) ) } ) );
    rest.appendChild( Ui.muted( Ui.t( "runs.rest_help" ) ) );
    rest.appendChild( this.screenEditor( block.rest_after , key + ".rest" , ( label , fn ) => editBlock( label , ( b ) => fn( b.rest_after ) ) , true ) );
    inner.appendChild( rest );
    body.appendChild( inner );
    card.appendChild( body );
    return card;
  },

  // The run to scale on one strip (dummies, lead-in, each block repeat,
  // rests, lead-out) with a time axis under it. Short parts are too narrow
  // to label there, so the same parts follow as an outline, one row per
  // block with its repeats folded together.
  timeline( run , info ) {
    const doc = Doc.doc;
    const grey = "#9aa3ad";
    const restGrey = "#c5ccd3";
    const parts = [];
    const rows = [];
    let clock = 0;
    const part = ( label , seconds , color , muted ) => {
      if ( seconds <= 0 ) return;
      parts.push( { label: label , seconds: seconds , color: color , muted: muted } );
      clock += seconds;
    };
    const plain = ( label , seconds , detail ) => {
      if ( seconds <= 0 ) return;
      rows.push( { start: clock , label: label , seconds: seconds , color: grey , muted: true , detail: detail || "" } );
      part( label , seconds , grey , true );
    };
    plain( Ui.t( "runs.dummies" ) , info.dummy * info.tr , Ui.t( "runs.outline_volumes" ).replace( "{n}" , info.dummy ) );
    plain( Ui.t( "runs.lead_in" ) , run.lead_in.seconds );
    // A rest follows every repeat but the run's very last (as Timing.run).
    let repeatsLeft = run.blocks.reduce( ( n , b ) => n + b.repeat , 0 );
    run.blocks.forEach( ( block , index ) => {
      const blockInfo = info.blocks.find( ( b ) => b.block === block );
      const first = block.mix.length ? Timing.trialTypeById( doc , block.mix[ 0 ].trial_type ) : null;
      const color = first ? first.color : null;
      const name = block.name || Ui.t( "runs.block" ) + " " + ( index + 1 );
      const start = clock;
      let rests = 0;
      for ( let r = 0; r < block.repeat; r += 1 ) {
        part( name , blockInfo.one.mean , color , false );
        repeatsLeft -= 1;
        if ( repeatsLeft > 0 && block.rest_after.seconds > 0 ) {
          part( Ui.t( "runs.rest_short" ) , block.rest_after.seconds , restGrey , true );
          rests += 1;
        }
      }
      if ( clock <= start ) return;
      const detail = [];
      if ( block.repeat > 1 ) detail.push( Ui.t( "runs.outline_each" ).replace( "{time}" , Timing.clock( blockInfo.one.mean ) ) );
      if ( rests ) {
        const kind = rests < block.repeat ? "between" : block.repeat > 1 ? "after_each" : "after";
        detail.push( Ui.t( "runs.outline_rest_" + kind ).replace( "{time}" , Timing.clock( block.rest_after.seconds ) ) );
      }
      rows.push( { start: start , label: block.repeat > 1 ? name + " × " + block.repeat : name , seconds: clock - start , color: color , muted: false , detail: detail.join( " · " ) } );
    } );
    plain( Ui.t( "runs.lead_out" ) , run.lead_out.seconds );

    const total = clock;
    const strip = Dom.el( "div" , { class: "timeline-strip" } );
    parts.forEach( ( p ) => {
      const node = Dom.el( "div" , { class: "timeline-bar" + ( p.muted ? " muted" : "" ) , attrs: { title: p.label + ": " + Timing.clock( p.seconds ) } , children: [
        Dom.el( "span" , { class: "timeline-label" , text: p.label } ), Dom.el( "span" , { class: "timeline-sub" , text: Timing.clock( p.seconds ) } ),
      ] } );
      node.style.flexGrow = String( p.seconds );
      if ( p.color ) node.style.setProperty( "--bar" , p.color );
      strip.appendChild( node );
    } );
    if ( total <= 0 ) return Dom.el( "div" , { class: "mt-2" , children: [ strip ] } );

    // Round ticks, at most about six, and none crowding the end's.
    const axis = Dom.el( "div" , { class: "timeline-axis" } );
    const step = [ 15 , 30 , 60 , 120 , 300 , 600 , 900 , 1800 , 3600 ].find( ( s ) => total / s <= 6 ) || 3600;
    const tick = ( seconds , end ) => {
      const node = Dom.el( "span" , { class: "timeline-tick" + ( end ? " end" : "" ) , text: Timing.clock( seconds ) } );
      node.style.left = ( seconds / total * 100 ) + "%";
      axis.appendChild( node );
    };
    for ( let t = 0; t < total * 0.92; t += step ) tick( t );
    tick( total , true );

    const outline = Dom.el( "div" , { class: "timeline-outline" } );
    const line = ( r , extra ) => {
      const swatch = Dom.el( "span" , { class: "swatch timeline-swatch" + ( r.muted ? " muted" : "" ) } );
      if ( r.color ) swatch.style.setProperty( "--bar" , r.color );
      outline.appendChild( Dom.el( "div" , { class: "timeline-row " + ( extra || "" ) , children: [
        Dom.el( "span" , { class: "timeline-start" , text: r.start == null ? "" : Timing.clock( r.start ) } ),
        Dom.el( "span" , { class: "timeline-name" , children: [ r.swatch === false ? Dom.el( "span" ) : swatch , Dom.el( "span" , { class: "text-truncate" , text: r.label } ) ] } ),
        Dom.el( "span" , { class: "timeline-length" , text: Timing.clock( r.seconds ) } ),
        Dom.el( "span" , { class: "timeline-detail" , text: r.detail || "" } ),
      ] } ) );
    };
    rows.forEach( ( r ) => line( r ) );
    line( { start: null , label: Ui.t( "runs.outline_total" ) , seconds: info.total.mean , swatch: false } , "timeline-total" );
    return Dom.el( "div" , { class: "mt-2" , children: [ strip , axis , outline ] } );
  },
};
