// The Trial types screen. A trial type is an ordered list of phases; each
// phase lasts a fixed or jittered time and shows a stack of layers. If the
// trial type draws from a prompt list, each trial gets one item and the
// layers' {column} values come from it.
//
// What used to be "conditions" is just this: two trial types that differ in
// their cue are two trial types. (Or one trial type, with the cue as a
// column of the prompt list.)
const Trials = {
  name: "trials",
  selected: null,
  previewItems: {},

  current() {
    const all = Doc.doc.trial_types;
    if ( !all.some( ( t ) => t.id === this.selected ) ) this.selected = all.length ? all[ 0 ].id : null;
    return all.find( ( t ) => t.id === this.selected ) || null;
  },

  focus( id ) {
    this.selected = id;
  },

  edit( label , fn , options ) {
    const id = this.selected;
    Doc.change( label , ( d ) => {
      const tt = d.trial_types.find( ( t ) => t.id === id );
      if ( tt ) fn( tt , d );
    } , options );
  },

  render( root ) {
    const doc = Doc.doc;
    root.replaceChildren();
    root.appendChild( Ui.muted( Ui.t( "trials.description" ) ) );
    const tt = this.current();
    const add = Ui.button( Ui.t( "trials.new" ) , "plus-lg" , () => {
      const fresh = Schema.trialType( Doc.nextName( "trial_types" , "trials.default_name" ) );
      if ( doc.lists.length ) fresh.list = doc.lists[ 0 ].id;
      Doc.change( Ui.t( "undo.trial_added" ) , ( d ) => d.trial_types.push( fresh ) );
      this.selected = fresh.id;
      Designer.refresh();
    } , { variant: "btn-outline-primary" , editOnly: true } );
    // A dropdown above the editor, which gets the full width.
    root.appendChild( Ui.picker( doc.trial_types.map( ( t ) => ( { id: t.id , name: t.name , color: t.color , meta: Timing.clock( Timing.trial( doc , t ).mean ) } ) ) , this.selected , ( id ) => {
      this.selected = id;
      Designer.refresh();
    } , { unnamed: Ui.t( "trials.unnamed" ) , dropdown: true , add: [ add ].concat( tt ? this.manage( tt ) : [] ) , label: Ui.t( "nav.trials" ) } ) );
    root.appendChild( tt ? this.editor( tt ) : Ui.empty( Ui.t( "trials.none" ) ) );
  },

  editor( tt ) {
    const doc = Doc.doc;
    const list = doc.lists.find( ( l ) => l.id === tt.list ) || null;
    const box = Dom.el( "div" );
    const usedBy = Validate.usages( doc , "trial_type" , tt.id );

    const about = [ Ui.row( [
      Ui.field( "trials.name" , Ui.text( tt.name , ( v ) => this.edit( Ui.t( "undo.trial_renamed" ) , ( t ) => { t.name = v.trim(); } ) , { key: "tt.name" } ) , { col: "col-md-5" } ),
      Ui.field( "trials.color" , Ui.color( tt.color , ( v ) => this.edit( Ui.t( "undo.trial_changed" ) , ( t ) => { t.color = v; } ) , { key: "tt.color" } ) , { col: "col-md-2" } ),
      Ui.field( "trials.notes" , Ui.text( tt.notes , ( v ) => this.edit( Ui.t( "undo.trial_changed" ) , ( t ) => { t.notes = v; } ) , { key: "tt.notes" } ) , { col: "col-md" } ),
    ] ) ];
    if ( usedBy.length ) about.push( Ui.muted( Ui.t( "trials.used_by" ) + " " + usedBy.join( ", " ) , "mt-2" ) );
    box.appendChild( Ui.section( Ui.t( "trials.section_trial" ) , about , { fold: "trials.about" } ) );

    // Where items come from.
    const listOptions = [ [ "" , Ui.t( "trials.no_list" ) ] ].concat( doc.lists.map( ( l ) => [ l.id , l.name || Ui.t( "lists.unnamed" ) ] ) );
    const fields = [ Ui.field( "trials.list" , Ui.select( tt.list , listOptions , ( v ) => this.edit( Ui.t( "undo.trial_changed" ) , ( t ) => { t.list = v; t.balance_by = ""; t.filter = { column: "" , values: [] }; } ) , { key: "tt.list" } ) , { col: "col-md-4" } ) ];
    if ( list ) {
      fields.push( Ui.field( "trials.order" , Ui.select( tt.order , [ [ "shuffle" , Ui.t( "trials.order_shuffle" ) ] , [ "sequential" , Ui.t( "trials.order_sequential" ) ] ] , ( v ) => this.edit( Ui.t( "undo.trial_changed" ) , ( t ) => { t.order = v; } ) , { key: "tt.order" } ) , { col: "col-md" } ) );
      if ( tt.order === "shuffle" ) {
        fields.push( Ui.field( "trials.no_repeat" , Ui.select( tt.no_repeat , [ "session" , "run" , "none" ].map( ( v ) => [ v , Ui.t( "trials.no_repeat_" + v ) ] ) , ( v ) => this.edit( Ui.t( "undo.trial_changed" ) , ( t ) => { t.no_repeat = v; } ) , { key: "tt.norepeat" } ) , { col: "col-md" } ) );
        fields.push( Ui.field( "trials.balance_by" , Ui.select( tt.balance_by , [ [ "" , Ui.t( "trials.balance_none" ) ] ].concat( list.columns.filter( ( c ) => c.type !== "image" ).map( ( c ) => [ c.key , c.label || c.key ] ) ) , ( v ) => this.edit( Ui.t( "undo.trial_changed" ) , ( t ) => { t.balance_by = v; } ) , { key: "tt.balance" } ) , { col: "col-md" } ) );
        const pair = tt.balance_by ? Compile.balancePair( tt , Compile.itemsFor( tt , list ) ) : null;
        if ( pair ) {
          fields.push( Ui.field( "trials.balance_pct" , Ui.number( tt.balance_pct , ( v ) => this.edit( Ui.t( "undo.trial_changed" ) , ( t ) => { t.balance_pct = Math.max( 0 , Math.min( 100 , v ) ); } ) , { key: "tt.balancepct" , min: 0 , max: 100 , step: 1 } ) , { col: "col-md-2" , help: Ui.t( "trials.balance_pct_help" ).replace( "{value}" , pair[ 0 ] ) } ) );
        }
      }
    }
    box.appendChild( Ui.section( Ui.t( "trials.prompts_heading" ) , [ Ui.row( fields ) , list ? this.filterRow( tt , list ) : null ] , { fold: "trials.items" } ) );

    // The trial at a glance, and ways to see it run.
    const span = Timing.trial( doc , tt );
    const strip = this.strip( tt );
    const actions = Dom.el( "div" , { class: "row-actions mt-2 align-items-center" } );
    let itemSelect = null;
    const drawable = Compile.itemsFor( tt , list );
    if ( drawable.length ) {
      const options = [ [ "" , Ui.t( "trials.random_item" ) ] ].concat( drawable.map( ( item ) => [ item.id , Compile.itemLabel( item , list ).slice( 0 , 60 ) ] ) );
      itemSelect = Ui.select( this.previewItems[ tt.id ] || "" , options , ( v ) => {
        this.previewItems[ tt.id ] = v;
        Designer.refresh();
      } , { small: true , key: "tt.previewitem" } );
      itemSelect.disabled = false;
      itemSelect.classList.add( "w-auto" );
      actions.appendChild( Dom.el( "span" , { class: "small text-body-secondary" , text: Ui.t( "trials.preview_item" ) } ) );
      actions.appendChild( itemSelect );
    }
    actions.appendChild( Ui.button( Ui.t( "run.play_trial" ) , "play-fill" , () => this.play( tt ) , { variant: "btn-primary" , small: true } ) );
    box.appendChild( Ui.section( Ui.t( "trials.timeline" ) + " · " + Timing.describe( span ) , [ strip , actions ] , { fold: "trials.timeline" } ) );

    // Phases.
    const item = this.previewItem( tt , list );
    const addPhase = Ui.button( Ui.t( "trials.add_phase" ) , "plus-lg" , () => this.edit( Ui.t( "undo.phase_added" ) , ( t ) => {
      t.phases.push( Schema.phase( Ui.t( "trials.new_phase" ) + " " + ( t.phases.length + 1 ) , Schema.duration( "fixed" , 1 ) , Schema.fixation() ) );
    } ) , { variant: "btn-outline-primary" , small: true , editOnly: true } );
    box.appendChild( Ui.section( Ui.t( "trials.phases" ) + " (" + tt.phases.length + ")" , tt.phases.map( ( phase , index ) => this.phaseCard( tt , phase , index , list , item ) ).concat( [
      Dom.el( "div" , { class: "mt-2" , children: [ Tables.actions( () => Tables.phases( Doc.doc , tt ) ) ] } ),
    ] ) , { actions: [ addPhase ] , fold: "trials.phases" } ) );

    box.appendChild( this.responses( tt ) );
    box.appendChild( Ui.section( Ui.t( "figures.heading" ) , Charts.figure( ( light , width ) => Figures.trial( Doc.doc , tt , light , width ) , "trial-" + ( tt.name || tt.id ) ) , { fold: "trials.figure" } ) );

    return box;
  },

  // Duplicate / delete, beside "New trial type" above the editor.
  manage( tt ) {
    const usedBy = Validate.usages( Doc.doc , "trial_type" , tt.id );
    const buttons = [];
    buttons.push( Ui.button( Ui.t( "ui.duplicate" ) , "files" , () => {
      const copy = JSON.parse( JSON.stringify( tt ) );
      copy.id = Schema.uid( "tt" );
      copy.name = ( tt.name || Ui.t( "trials.unnamed" ) ) + " " + Ui.t( "ui.copy_suffix" );
      copy.phases.forEach( ( p ) => { p.id = Schema.uid( "ph" ); p.layers.forEach( ( l ) => { l.id = Schema.uid( "l" ); } ); } );
      Doc.change( Ui.t( "undo.trial_added" ) , ( d ) => d.trial_types.push( copy ) );
      this.selected = copy.id;
      Designer.refresh();
    } , { editOnly: true } ) );
    buttons.push( Ui.button( Ui.t( "ui.delete" ) , "trash" , () => {
      if ( usedBy.length ) {
        Dom.toast( Ui.t( "trials.still_used" ) + " " + usedBy.join( ", " ) , "error" );
        return;
      }
      Doc.change( Ui.t( "undo.trial_deleted" ) , ( d ) => { d.trial_types = d.trial_types.filter( ( t ) => t.id !== tt.id ); } , { toast: true } );
    } , { variant: "btn-outline-danger" , editOnly: true } ) );
    return buttons;
  },

  previewItem( tt , list ) {
    const items = Compile.itemsFor( tt , list );
    if ( !items.length ) return null;
    return items.find( ( i ) => i.id === this.previewItems[ tt.id ] ) || items[ 0 ];
  },

  // "Only items where [column] is [values]": a column, then one toggle per
  // value that column holds in the list.
  filterRow( tt , list ) {
    const columns = list.columns.filter( ( c ) => c.type !== "image" );
    const column = columns.find( ( c ) => c.key === tt.filter.column ) || null;
    const options = [ [ "" , Ui.t( "trials.filter_all" ) ] ].concat( columns.map( ( c ) => [ c.key , c.label || c.key ] ) );
    const fields = [ Ui.field( "trials.filter" , Ui.select( column ? column.key : "" , options , ( v ) => this.edit( Ui.t( "undo.trial_changed" ) , ( t ) => {
      t.filter = { column: v , values: [] };
    } ) , { key: "tt.filter" } ) , { col: "col-md-4" } ) ];
    if ( column ) {
      const values = [];
      list.items.forEach( ( item ) => {
        const v = item.values[ column.key ] == null ? "" : String( item.values[ column.key ] );
        if ( !values.includes( v ) ) values.push( v );
      } );
      tt.filter.values.forEach( ( v ) => { if ( !values.includes( v ) ) values.push( v ); } );
      const wrap = Dom.el( "div" , { class: "chip-row" } );
      values.forEach( ( v ) => {
        const on = tt.filter.values.includes( v );
        const count = list.items.filter( ( item ) => ( item.values[ column.key ] == null ? "" : String( item.values[ column.key ] ) ) === v ).length;
        const chip = Dom.el( "button" , {
          class: "btn btn-sm chip " + ( on ? "btn-primary" : "btn-light" ) ,
          text: ( v === "" ? Ui.t( "trials.filter_blank" ) : v ) + " (" + count + ")" ,
          attrs: { type: "button" , "aria-pressed": on ? "true" : "false" },
        } );
        chip.disabled = Ui.readOnly();
        chip.addEventListener( "click" , () => this.edit( Ui.t( "undo.trial_changed" ) , ( t ) => {
          t.filter.values = on ? t.filter.values.filter( ( x ) => x !== v ) : t.filter.values.concat( [ v ] );
        } ) );
        wrap.appendChild( chip );
      } );
      const drawn = Compile.itemsFor( tt , list ).length;
      fields.push( Ui.field( "trials.filter_values" , wrap , { col: "col-md" , help: Ui.t( tt.filter.values.length ? "trials.filter_count" : "trials.filter_pick" ).replace( "{count}" , drawn ).replace( "{total}" , list.items.length ) } ) );
    }
    return Ui.row( fields , "mt-1" );
  },

  play( tt ) {
    RunDialog.open( {
      title: tt.name || Ui.t( "trials.unnamed" ),
      kind: "trial",
      build: ( options ) => Compile.trialPlans( Doc.doc , { id: Doc.id } , tt.id , this.previewItems[ tt.id ] || "" , options ),
    } );
  },

  // The phases as bars, as wide as their mean duration.
  strip( tt ) {
    const doc = Doc.doc;
    const strip = Dom.el( "div" , { class: "timeline-strip" } );
    const spans = tt.phases.map( ( p ) => Timing.span( p.duration , doc.scanner.tr ) );
    const total = spans.reduce( ( s , x ) => s + x.mean , 0 ) || 1;
    tt.phases.forEach( ( phase , i ) => {
      const bar = Dom.el( "div" , { class: "timeline-bar" + ( phase.duration.kind === "fixed" ? "" : " jittered" ) , attrs: { title: ( phase.name || "" ) + ": " + Timing.describe( spans[ i ] ) } , children: [
        Dom.el( "span" , { class: "timeline-label" , text: phase.name || "–" } ),
        Dom.el( "span" , { class: "timeline-sub" , text: Timing.describe( spans[ i ] ).split( " · " )[ 0 ] } ),
      ] } );
      bar.style.flexGrow = String( Math.max( spans[ i ].mean , total * 0.04 ) );
      bar.style.setProperty( "--bar" , tt.color );
      strip.appendChild( bar );
    } );
    return strip;
  },

  phaseCard( tt , phase , index , list , item ) {
    const doc = Doc.doc;
    const key = "ph." + phase.id;
    const editPhase = ( label , fn , options ) => this.edit( label , ( t ) => {
      const p = t.phases.find( ( x ) => x.id === phase.id );
      if ( p ) fn( p , t );
    } , options );
    const card = Dom.el( "div" , { class: "card phase-card mb-3" } );
    const body = Dom.el( "div" , { class: "card-body" } );

    const head = Dom.el( "div" , { class: "d-flex gap-2 align-items-center flex-wrap" } );
    const columns = Dom.el( "div" , { class: "row g-3" } );
    const inner = Dom.el( "div" , { class: "mt-2" , children: [ columns ] } );
    head.appendChild( Ui.folding( key , "" , [ inner ] , head ) );
    head.appendChild( Dom.el( "span" , { class: "phase-number" , text: String( index + 1 ) } ) );
    head.appendChild( Dom.el( "div" , { class: "flex-grow-1" , children: [ Ui.text( phase.name , ( v ) => editPhase( Ui.t( "undo.phase_renamed" ) , ( p ) => { p.name = v.trim(); } ) , { key: key + ".name" , placeholder: Ui.t( "trials.phase_name" ) } ) ] } ) );
    if ( !Doc.readOnly ) {
      head.appendChild( Ui.icon( "arrow-up" , Ui.t( "ui.move_up" ) , () => editPhase( Ui.t( "undo.phase_moved" ) , ( p , t ) => Ui.move( t.phases , t.phases.indexOf( p ) , -1 ) ) , { disabled: index === 0 } ) );
      head.appendChild( Ui.icon( "arrow-down" , Ui.t( "ui.move_down" ) , () => editPhase( Ui.t( "undo.phase_moved" ) , ( p , t ) => Ui.move( t.phases , t.phases.indexOf( p ) , 1 ) ) , { disabled: index === tt.phases.length - 1 } ) );
      head.appendChild( Ui.icon( "files" , Ui.t( "ui.duplicate" ) , () => editPhase( Ui.t( "undo.phase_added" ) , ( p , t ) => {
        const copy = JSON.parse( JSON.stringify( p ) );
        copy.id = Schema.uid( "ph" );
        copy.layers.forEach( ( l ) => { l.id = Schema.uid( "l" ); } );
        t.phases.splice( t.phases.indexOf( p ) + 1 , 0 , copy );
      } ) ) );
      head.appendChild( Ui.icon( "trash" , Ui.t( "ui.delete" ) , () => editPhase( Ui.t( "undo.phase_deleted" ) , ( p , t ) => t.phases.splice( t.phases.indexOf( p ) , 1 ) , { toast: true } ) , { variant: "btn-outline-danger" } ) );
    }
    body.appendChild( head );

    const left = Dom.el( "div" , { class: "col-xl-8" } );
    left.appendChild( this.durationEditor( phase , key , editPhase ) );
    if ( phase.duration.kind !== "fixed" ) left.appendChild( this.jitter( tt , phase ) );
    left.appendChild( Ui.check( phase.modelled , Ui.t( "trials.modelled" ) , ( v ) => editPhase( Ui.t( "undo.phase_changed" ) , ( p ) => { p.modelled = v; } ) , { key: key + ".modelled" , class: "mt-2" } ) );
    left.appendChild( Ui.row( [
      Ui.field( "trials.response_keys" , Ui.text( phase.response.keys.join( ", " ) , ( v ) => editPhase( Ui.t( "undo.phase_changed" ) , ( p ) => { p.response.keys = v.split( /[\s,]+/ ).filter( Boolean ); } ) , { key: key + ".keys" , placeholder: Ui.t( "trials.response_placeholder" ) , small: true } ) , { col: "col-md-6" , help: Ui.t( "trials.response_help" ) } ),
      phase.response.keys.length ? Dom.el( "div" , { class: "col-md-6" , children: [ Ui.check( phase.response.ends_phase , Ui.t( "trials.blank_after_response" ) , ( v ) => editPhase( Ui.t( "undo.phase_changed" ) , ( p ) => { p.response.ends_phase = v; } ) , { key: key + ".ends" } ) ] } ) : null,
    ] , "mt-1" ) );
    left.appendChild( Ui.heading( Ui.t( "trials.on_screen" ) , 4 , "mt-3" ) );
    left.appendChild( LayerEditor.render( {
      layers: phase.layers , list: list , key: key,
      edit: ( label , fn ) => editPhase( label , ( p ) => fn( p.layers ) ),
    } ) );
    const right = Dom.el( "div" , { class: "col-xl-4" } );
    const screen = Display.screen( doc.display.aspect );
    Display.preview( screen , doc , phase.layers , item , list , ( sha ) => Doc.mediaUrl( sha ) );
    right.appendChild( Dom.el( "div" , { class: "preview-sticky" , children: [ screen , Dom.el( "div" , { class: "small text-body-secondary mt-1" , text: item ? Ui.t( "trials.showing_item" ) + " " + Compile.itemLabel( item , list ) : Ui.t( "trials.no_item_preview" ) } ) ] } ) );
    columns.appendChild( left );
    columns.appendChild( right );
    body.appendChild( inner );
    card.appendChild( body );
    return card;
  },

  // A jittered phase's distribution of waits, folded away until asked for.
  jitter( tt , phase ) {
    const doc = Doc.doc;
    const rows = Tables.jitterRows( doc , phase.duration );
    const details = Dom.el( "details" , { class: "jitter-details mt-2" } );
    const open = this.openJitter && this.openJitter.has( phase.id );
    if ( open ) details.open = true;
    details.addEventListener( "toggle" , () => {
      this.openJitter = this.openJitter || new Set();
      if ( details.open ) this.openJitter.add( phase.id ); else this.openJitter.delete( phase.id );
      if ( details.open && !details.dataset.filled ) fill();
    } );
    details.appendChild( Dom.el( "summary" , { class: "small" , text: Ui.t( "trials.jitter_show" ) } ) );
    const fill = () => {
      details.dataset.filled = "1";
      if ( !rows.length ) {
        details.appendChild( Ui.muted( Ui.t( "trials.jitter_none" ) ) );
        return;
      }
      const geometric = phase.duration.kind === "geometric";
      const last = Timing.anticipatable( phase.duration , doc.scanner.tr );
      if ( last != null ) details.appendChild( Ui.muted( Ui.t( "trials.anticipatable" ).replace( "{pct}" , Tables.f( last * 100 , 1 ) ) , "mt-1" ) );
      const label = ( r ) => ( geometric ? Tables.f( r.wait ) : Tables.f( ( r.wait + r.to ) / 2 , 1 ) );
      const make = ( light , width ) => Charts.bars( {
        light: light , height: 170 , title: light ? Tables.jitter( doc , tt , phase ).title : "" ,
        bars: rows.map( ( r ) => ( { label: label( r ) , value: r.p * 100 } ) ),
        format: ( v ) => Charts.number( Math.round( v * 10 ) / 10 ) + "%" , xLabel: Ui.t( "trials.jitter_axis" ) , color: light ? null : tt.color,
      } , Math.max( 280 , width || 560 ) );
      details.appendChild( Charts.figure( make , "jitter-" + ( tt.name || "" ) + "-" + ( phase.name || "" ) ) );
      details.appendChild( Tables.view( Tables.jitter( doc , tt , phase ) , { class: "mt-2" } ) );
    };
    if ( open ) fill();
    return details;
  },

  // The predicted BOLD of each modelled phase over two trials back to back,
  // and how much each overlaps the next.
  responses( tt ) {
    const doc = Doc.doc;
    const card = Ui.section( Ui.t( "trials.responses" ) , [] , { help: Ui.t( "trials.responses_help" ) , fold: "trials.responses" } );
    const body = card.querySelector( ".card-body" );
    const result = Efficiency.trial( doc , tt , 2 );
    if ( !result.traces.length ) {
      body.appendChild( Ui.empty( Ui.t( "trials.responses_none" ) ) );
      return card;
    }
    const pct = ( x ) => ( x == null ? "–" : Tables.f( x * 100 , 1 ) + "%" );
    const stats = Dom.el( "div" , { class: "stat-row mb-3" } );
    const stat = ( label , value , sub , tone ) => stats.appendChild( Dom.el( "div" , { class: "stat" + ( tone ? " stat-" + tone : "" ) , children: [
      Dom.el( "div" , { class: "stat-label" , text: label } ), Dom.el( "div" , { class: "stat-value" , text: value } ), Dom.el( "div" , { class: "stat-sub" , text: sub || "" } ),
    ] } ) );
    stat( Ui.t( "trials.resp_count" ) , String( result.traces.length ) , Ui.t( "trials.resp_count_sub" ) );
    stat( Ui.t( "trials.resp_period" ) , Tables.f( result.period , 1 ) + " s" , Ui.t( "trials.resp_period_sub" ) );
    if ( result.closestGap != null ) stat( Ui.t( "trials.resp_gap" ) , Tables.f( result.closestGap , 1 ) + " s" , Ui.t( "trials.resp_gap_sub" ) , result.closestGap < 2 ? "warn" : "" );
    if ( result.worstBleed != null ) stat( Ui.t( "trials.resp_bleed" ) , pct( result.worstBleed ) , Ui.t( "trials.resp_bleed_sub" ) , result.worstBleed > 0.5 ? "warn" : "" );
    stat( Ui.t( "trials.resp_carry" ) , pct( result.worstCarryover ) , Ui.t( "trials.resp_carry_sub" ) , result.worstCarryover > 0.25 ? "warn" : "" );
    stat( Ui.t( "trials.resp_span" ) , Tables.f( doc.hrf.span , 0 ) + " s" , Ui.t( "trials.resp_span_sub" ) );
    body.appendChild( stats );

    const vlines = [];
    for ( let r = 0; r < result.repeats; r += 1 ) vlines.push( { x: r * result.period , label: Ui.t( "trials.resp_trial" ).replace( "{n}" , r + 1 ) , row: 1 } );
    const plot = Charts.linePlot( {
      key: "resp." + tt.id , t: result.t , height: 260 , zoom: true , legend: true ,
      title: Ui.t( "trials.responses_title" ).replace( "{name}" , tt.name || "" ),
      series: result.traces.map( ( x ) => ( { label: x.label , values: x.values } ) ),
      bands: [].concat( ...result.traces.map( ( x , i ) => x.windows.map( ( w ) => ( { x0: w[ 0 ] , x1: w[ 1 ] , series: i , opacity: 0.13 } ) ) ) ),
      markers: result.traces.map( ( x , i ) => ( { x: x.peakTime , y: x.values[ Math.round( x.peakTime * 10 ) ] , series: i , label: Tables.f( x.peakTime , 1 ) + " s" } ) ),
      vlines: vlines,
      // Trial 1 and the start of the next, so its responses peak in view.
      buttons: [ { text: Ui.t( "trials.resp_one_trial" ) , icon: "crop" , run: ( view ) => { view.x0 = 0; view.x1 = result.period + doc.hrf.peak_delay; } } ],
    } );
    body.appendChild( plot.element );
    body.appendChild( Charts.downloads( ( light ) => plot.svg( light ) , "responses-" + ( tt.name || tt.id ) ) );
    body.appendChild( Ui.muted( Ui.t( "trials.responses_caption" ) , "mt-2" ) );
    const colors = Charts.palette().series;
    const table = {
      id: "responses-" + tt.id , title: Ui.t( "trials.responses_title" ).replace( "{name}" , tt.name ) ,
      columns: [ Ui.t( "trials.resp_col_phase" ) , Ui.t( "trials.resp_col_window" ) , Ui.t( "trials.resp_col_peak" ) , Ui.t( "trials.resp_col_value" ) , Ui.t( "trials.resp_col_bleed" ) , Ui.t( "trials.resp_col_carry" ) ],
      rows: result.traces.map( ( x , i ) => [ { text: x.label , color: colors[ i % colors.length ] } , Tables.f( x.onset , 1 ) + "–" + Tables.f( x.onset + x.duration , 1 ) + " s" , Tables.f( x.peakTime , 1 ) + " s" , Tables.f( x.peak , 3 ) , pct( x.bleed ) , pct( x.carryover ) ] ),
    };
    body.appendChild( Tables.view( table , { class: "mt-3" , toggle: plot } ) );
    return card;
  },

  durationEditor( phase , key , editPhase ) {
    const doc = Doc.doc;
    const d = phase.duration;
    const set = ( field ) => ( v ) => editPhase( Ui.t( "undo.duration_changed" ) , ( p ) => { p.duration[ field ] = v; } );
    // "Design jitter" follows doc.jitter (normalise copies it in); the others
    // are this phase's own.
    const kinds = [ [ "fixed" , Ui.t( "trials.kind_fixed" ) ] , [ "inherit" , Ui.t( "trials.kind_inherit" ).replace( "{mode}" , Ui.t( "settings.jitter_mode_" + doc.jitter.mode ) ) ] ]
      .concat( Schema.JITTER_MODES.map( ( k ) => [ k , Ui.t( "trials.kind_" + k ) ] ) );
    const fields = [ Ui.field( "trials.duration" , Ui.select( d.inherit ? "inherit" : d.kind , kinds , ( v ) => editPhase( Ui.t( "undo.duration_changed" ) , ( p ) => {
      const kind = v === "inherit" ? doc.jitter.mode : v;
      // A geometric steps in whole TRs, so give it two rungs above the old
      // value; ±1 s would leave it nothing to vary over at most TRs.
      if ( kind === "geometric" && p.duration.kind === "fixed" ) {
        p.duration.min = p.duration.value;
        p.duration.max = Timing.round4( p.duration.value + 2 * doc.scanner.tr );
      } else if ( kind !== "fixed" && p.duration.kind === "fixed" ) {
        p.duration.min = Math.max( 0 , p.duration.value - 1 );
        p.duration.max = p.duration.value + 1;
      }
      p.duration.kind = kind;
      p.duration.inherit = v === "inherit";
    } ) , { small: true , key: key + ".kind" } ) , { col: "col-6 col-md-3" } ) ];
    const n = ( labelKey , field , extra ) => Ui.field( labelKey , Ui.number( d[ field ] , set( field ) , Object.assign( { key: key + "." + field , min: 0 , step: 0.1 , small: true } , extra ) ) , { col: "col-6 col-md-2" } );
    if ( d.kind === "fixed" ) {
      fields.push( n( "trials.seconds" , "value" ) );
    } else {
      fields.push( n( "trials.min" , "min" ) );
      fields.push( n( "trials.max" , "max" ) );
      if ( d.kind === "geometric" && !d.inherit ) {
        fields.push( n( "trials.p" , "p" , { min: 0.02 , max: 0.98 , step: 0.05 } ) );
        fields.push( n( "trials.cap" , "cap_trs" , { min: 0 , step: 1 } ) );
      }
      if ( d.kind === "exponential" && !d.inherit ) fields.push( n( "trials.scale" , "scale" , { min: 0.05 , max: 5 , step: 0.05 } ) );
      if ( d.kind === "uniform" || d.kind === "exponential" ) {
        fields.push( Dom.el( "div" , { class: "col-6 col-md-3" , children: [ Ui.check( d.snap_to_tr , Ui.t( "trials.snap" ) , set( "snap_to_tr" ) , { key: key + ".snap" } ) ] } ) );
      }
    }
    const wrap = Dom.el( "div" , { children: [ Ui.row( fields ) ] } );
    const span = Timing.span( d , doc.scanner.tr );
    let note = Timing.describe( span );
    if ( d.kind === "geometric" ) {
      const g = Timing.geometric( d , doc.scanner.tr );
      const steps = g.probs.map( ( p , k ) => Timing.round4( d.min + k * doc.scanner.tr ) + " s (" + Math.round( p * 100 ) + "%)" );
      note = Ui.t( "trials.geometric_steps" ).replace( "{tr}" , doc.scanner.tr ) + " " + steps.join( ", " );
    }
    wrap.appendChild( Dom.el( "div" , { class: "form-text" , text: note } ) );
    return wrap;
  },
};
