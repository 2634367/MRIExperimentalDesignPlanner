// The Overview screen: the experiment's name, the scanner hours you have,
// and how they are split. There is no optimiser: you set how many of each
// session every participant does and how many participants there are, and
// the bar shows what that costs against the hours available. The trial
// counts and prompt usage below follow from those numbers.
const Overview = {
  name: "overview",

  render( root ) {
    const doc = Doc.doc;
    const budget = Timing.budget( doc );
    root.replaceChildren();

    root.appendChild( Ui.section( Ui.t( "overview.section_experiment" ) , Ui.row( [
      Ui.field( "overview.name" , Ui.text( doc.name , ( v ) => {
        if ( !v.trim() ) return Designer.refresh();
        Doc.change( Ui.t( "undo.experiment_renamed" ) , ( d ) => { d.name = v.trim(); } );
      } , { key: "exp.name" } ) , { col: "col-md-6" } ),
      Ui.field( "overview.notes" , Ui.text( doc.notes , ( v ) => Doc.change( Ui.t( "undo.experiment_changed" ) , ( d ) => { d.notes = v; } ) , { key: "exp.notes" } ) , { col: "col-md" } ),
    ] ) ) );

    // Hours.
    const hours = Dom.el( "div" );
    hours.appendChild( Ui.row( [
      Ui.field( "overview.hours" , Ui.number( doc.budget.hours_available , ( v ) => Doc.change( Ui.t( "undo.budget_changed" ) , ( d ) => { d.budget.hours_available = Math.max( 0 , v ); } ) , { key: "bud.hours" , min: 0 , step: 0.5 } ) , { col: "col-6 col-md-3" } ),
      Ui.field( "overview.participants" , this.stepper( doc.budget.participants , ( v ) => Doc.change( Ui.t( "undo.budget_changed" ) , ( d ) => { d.budget.participants = Math.max( 0 , v ); } , { merge: "participants" } ) , "bud.people" ) , { col: "col-6 col-md-3" } ),
      Dom.el( "div" , { class: "col-md" , children: [ this.summary( budget ) ] } ),
    ] ) );
    hours.appendChild( this.bar( doc , budget ) );

    // Sessions and their counts.
    const table = Dom.el( "table" , { class: "table align-middle mt-3" } );
    table.appendChild( Dom.el( "thead" , { children: [ Dom.el( "tr" , { children: [
      Dom.el( "th" , { text: Ui.t( "overview.session" ) } ),
      Dom.el( "th" , { text: Ui.t( "overview.length" ) } ),
      Dom.el( "th" , { text: Ui.t( "overview.per_participant" ) } ),
      Dom.el( "th" , { class: "text-end" , text: Ui.t( "overview.hours_total" ) } ),
    ] } ) ] } ) );
    const body = Dom.el( "tbody" );
    budget.rows.forEach( ( row , index ) => {
      const link = Dom.el( "a" , { text: row.session.name || Ui.t( "sessions.unnamed" ) , attrs: { href: "#sessions" } } );
      link.addEventListener( "click" , () => Sessions.focus( row.session.id ) );
      const swatch = Dom.el( "span" , { class: "swatch me-2" } );
      swatch.style.background = this.color( index );
      body.appendChild( Dom.el( "tr" , { children: [
        Dom.el( "td" , { children: [ swatch , link ] } ),
        Dom.el( "td" , { class: "small" , text: Timing.clock( row.info.seconds.mean ) } ),
        Dom.el( "td" , { children: [ this.stepper( row.session.count , ( v ) => Doc.change( Ui.t( "undo.session_count" ) , ( d ) => {
          const s = d.sessions.find( ( x ) => x.id === row.session.id );
          if ( s ) s.count = Math.max( 0 , v );
        } , { merge: "count:" + row.session.id } ) , "count." + row.session.id ) ] } ),
        Dom.el( "td" , { class: "text-end" , text: Timing.hours( row.hours * doc.budget.participants ) } ),
      ] } ) );
    } );
    if ( !budget.rows.length ) body.appendChild( Dom.el( "tr" , { children: [ Dom.el( "td" , { attrs: { colspan: "4" } , children: [ Ui.empty( Ui.t( "overview.no_sessions" ) ) ] } ) ] } ) );
    table.appendChild( body );
    hours.appendChild( Dom.el( "div" , { class: "table-responsive" , children: [ table ] } ) );
    const data = Timing.dataVolume( doc );
    if ( data.perParticipant > 0 ) {
      let text = Ui.t( "overview.data_total" ).replace( "{each}" , Timing.size( data.perParticipant ) ).replace( "{all}" , Timing.size( data.total ) );
      if ( data.unsized ) text += " " + Ui.t( "overview.data_unsized" ).replace( "{n}" , data.unsized );
      hours.appendChild( Ui.muted( text , "mb-2" ) );
    }
    hours.appendChild( Tables.actions( () => Tables.budget( Doc.doc ) ) );
    root.appendChild( Ui.section( Ui.t( "overview.budget" ) , hours ) );

    // Your own limits: over one is a warning below, never a refusal.
    const limit = ( key , field , step ) => Ui.field( "overview." + key , Ui.number( doc.limits[ field ] , ( v ) => Doc.change( Ui.t( "undo.budget_changed" ) , ( d ) => { d.limits[ field ] = Math.max( 0 , v ); } ) , { key: "lim." + field , min: 0 , step: step } ) , { col: "col-md-4" } );
    root.appendChild( Ui.section( Ui.t( "overview.limits" ) , [
      Ui.row( [ limit( "limit_run" , "max_run_minutes" , 1 ) , limit( "limit_session" , "max_session_minutes" , 5 ) , limit( "limit_runs" , "max_runs_per_session" , 1 ) ] ),
    ] , { help: Ui.t( "overview.limits_help" ) } ) );

    // What that buys.
    const totals = Dom.el( "div" , { class: "row g-3" } );
    totals.appendChild( Dom.el( "div" , { class: "col-md-6" , children: [ Ui.section( Ui.t( "overview.trials_heading" ) , this.trialTotals( doc , budget ) , { extra: "h-100 mb-0" } ) ] } ) );
    totals.appendChild( Dom.el( "div" , { class: "col-md-6" , children: [ Ui.section( Ui.t( "overview.lists_heading" ) , this.listUsage( doc ) , { extra: "h-100 mb-0" } ) ] } ) );
    root.appendChild( Dom.el( "div" , { class: "mb-3" , children: [ totals ] } ) );

    root.appendChild( Ui.section( Ui.t( "overview.problems" ) , Designer.problemList( Validate.check( doc ) ) ) );
  },

  color( index ) {
    return [ "#4c78a8" , "#f58518" , "#54a24b" , "#e45756" , "#72b7b2" , "#b279a2" , "#eeca3b" , "#9d755d" ][ index % 8 ];
  },

  // − [n] +, one undo step for a burst of clicks.
  stepper( value , commit , key ) {
    const group = Dom.el( "div" , { class: "input-group stepper" } );
    const minus = Ui.button( "" , "dash-lg" , () => commit( value - 1 ) , { title: Ui.t( "ui.less" ) } );
    const plus = Ui.button( "" , "plus-lg" , () => commit( value + 1 ) , { title: Ui.t( "ui.more" ) } );
    const input = Ui.number( value , ( v ) => commit( Math.round( v ) ) , { key: key , min: 0 , step: 1 } );
    minus.disabled = Doc.readOnly || value <= 0;
    plus.disabled = Doc.readOnly;
    minus.setAttribute( "data-key" , key + ".minus" );
    plus.setAttribute( "data-key" , key + ".plus" );
    group.append( minus , input , plus );
    return group;
  },

  summary( budget ) {
    const over = budget.available > 0 && budget.used > budget.available;
    const text = Ui.t( over ? "overview.summary_over" : "overview.summary" )
      .replace( "{used}" , Timing.hours( budget.used ) )
      .replace( "{available}" , Timing.hours( budget.available ) )
      .replace( "{left}" , Timing.hours( Math.abs( budget.left ) ) )
      .replace( "{each}" , Timing.hours( budget.perParticipant ) );
    const box = Dom.el( "div" , { class: "budget-summary" + ( over ? " over" : "" ) , children: [ Dom.el( "div" , { text: text } ) ] } );
    if ( budget.perParticipant > 0 && budget.available > 0 ) {
      const fit = Math.floor( budget.available / budget.perParticipant + 1e-9 );
      box.appendChild( Dom.el( "div" , { class: "small text-body-secondary" , text: Ui.t( "overview.fits" ).replace( "{count}" , fit ) } ) );
    }
    return box;
  },

  // Hours used per session type, against the hours available.
  bar( doc , budget ) {
    const scale = Math.max( budget.available , budget.used , 1e-9 );
    const track = Dom.el( "div" , { class: "budget-bar mt-2" } );
    budget.rows.forEach( ( row , index ) => {
      const hours = row.hours * doc.budget.participants;
      if ( hours <= 0 ) return;
      const part = Dom.el( "div" , { class: "budget-part" , attrs: { title: ( row.session.name || "" ) + ": " + Timing.hours( hours ) } } );
      part.style.width = ( ( hours / scale ) * 100 ).toFixed( 3 ) + "%";
      part.style.background = this.color( index );
      track.appendChild( part );
    } );
    if ( budget.available > 0 ) {
      const mark = Dom.el( "div" , { class: "budget-mark" , attrs: { title: Ui.t( "overview.available_mark" ) } } );
      mark.style.left = ( ( budget.available / scale ) * 100 ).toFixed( 3 ) + "%";
      track.appendChild( mark );
    }
    return track;
  },

  trialTotals( doc , budget ) {
    if ( !doc.trial_types.length ) return Ui.muted( Ui.t( "trials.none" ) );
    const table = Dom.el( "table" , { class: "table table-sm" } );
    const body = Dom.el( "tbody" );
    doc.trial_types.forEach( ( tt ) => {
      const swatch = Dom.el( "span" , { class: "swatch me-2" } );
      swatch.style.background = tt.color;
      body.appendChild( Dom.el( "tr" , { children: [
        Dom.el( "td" , { children: [ swatch , Dom.el( "span" , { text: tt.name || Ui.t( "trials.unnamed" ) } ) ] } ),
        Dom.el( "td" , { class: "text-end" , text: String( budget.counts[ tt.id ] || 0 ) } ),
        Dom.el( "td" , { class: "text-end small text-body-secondary" , text: doc.budget.participants ? Ui.t( "overview.each" ).replace( "{count}" , Math.round( ( budget.counts[ tt.id ] || 0 ) / doc.budget.participants ) ) : "" } ),
      ] } ) );
    } );
    table.appendChild( body );
    return table;
  },

  listUsage( doc ) {
    if ( !doc.lists.length ) return Ui.muted( Ui.t( "lists.none" ) );
    const table = Dom.el( "table" , { class: "table table-sm" } );
    const body = Dom.el( "tbody" );
    doc.lists.forEach( ( list ) => {
      const users = Validate.usages( doc , "list" , list.id );
      body.appendChild( Dom.el( "tr" , { children: [
        Dom.el( "td" , { text: list.name || Ui.t( "lists.unnamed" ) } ),
        Dom.el( "td" , { class: "text-end" , text: Ui.t( "overview.items" ).replace( "{count}" , list.items.length ) } ),
        Dom.el( "td" , { class: "small text-body-secondary" , text: users.length ? users.join( ", " ) : Ui.t( "lists.unused" ) } ),
      ] } ) );
    } );
    table.appendChild( body );
    return table;
  },
};

// The Scanner & display screen: the settings every run plan carries.
const Settings = {
  name: "settings",

  render( root ) {
    const doc = Doc.doc;
    const set = ( section , field , label ) => ( v ) => Doc.change( Ui.t( label || "undo.settings_changed" ) , ( d ) => { d[ section ][ field ] = v; } );
    root.replaceChildren();
    // Every row is the same four columns, so fields line up down the page.
    const col = "col-sm-6 col-lg-3";
    const section = ( heading , rows ) => Ui.section( heading , rows );
    root.appendChild( section( Ui.t( "settings.scanner" ) , [ Ui.row( [
      Ui.field( "settings.tr" , Ui.number( doc.scanner.tr , set( "scanner" , "tr" ) , { key: "sc.tr" , min: 0.05 , step: 0.05 } ) , { col: col , help: Ui.t( "settings.tr_help" ) } ),
      Ui.field( "settings.dummy" , Ui.number( doc.scanner.dummy_volumes , ( v ) => set( "scanner" , "dummy_volumes" )( Math.max( 0 , Math.round( v ) ) ) , { key: "sc.dummy" , min: 0 , step: 1 } ) , { col: col , help: Ui.t( "settings.dummy_help" ) } ),
      Ui.field( "settings.trigger" , Ui.text( doc.scanner.trigger_key , set( "scanner" , "trigger_key" ) , { key: "sc.trigger" , maxlength: 20 } ) , { col: col , help: Ui.t( "settings.trigger_help" ) } ),
    ] ) ] ) );
    root.appendChild( section( Ui.t( "settings.keys" ) , [ Ui.row( [
      Ui.field( "settings.quit_keys" , Ui.text( doc.keys.quit.join( ", " ) , ( v ) => Doc.change( Ui.t( "undo.settings_changed" ) , ( d ) => { d.keys.quit = v.split( /[\s,]+/ ).filter( Boolean ); } ) , { key: "keys.quit" } ) , { col: col , help: Ui.t( "settings.quit_help" ) } ),
      Ui.field( "settings.advance_keys" , Ui.text( doc.keys.advance.join( ", " ) , ( v ) => Doc.change( Ui.t( "undo.settings_changed" ) , ( d ) => { d.keys.advance = v.split( /[\s,]+/ ).filter( Boolean ); } ) , { key: "keys.adv" } ) , { col: col , help: Ui.t( "settings.advance_help" ) } ),
    ] ) ] ) );

    const display = section( Ui.t( "settings.display" ) , [ Ui.row( [
      Ui.field( "settings.background" , Ui.color( doc.display.background , set( "display" , "background" ) , { key: "d.bg" , hex: true } ) , { col: col } ),
      Ui.field( "settings.text_color" , Ui.color( doc.display.text_color , set( "display" , "text_color" ) , { key: "d.fg" , hex: true } ) , { col: col } ),
      Ui.field( "settings.font" , Ui.text( doc.display.font , set( "display" , "font" ) , { key: "d.font" } ) , { col: col } ),
      Ui.field( "settings.aspect" , Ui.select( String( doc.display.aspect ) , [ [ "1.6" , "16:10" ] , [ "1.7778" , "16:9" ] , [ "1.3333" , "4:3" ] , [ "1.25" , "5:4" ] ].concat(
        [ "1.6" , "1.7778" , "1.3333" , "1.25" ].includes( String( doc.display.aspect ) ) ? [] : [ [ String( doc.display.aspect ) , String( doc.display.aspect ) ] ] ) ,
      ( v ) => set( "display" , "aspect" )( Number( v ) ) , { key: "d.aspect" } ) , { col: col , help: Ui.t( "settings.aspect_help" ) } ),
    ] ) ] );
    root.appendChild( display );
    const sample = Display.screen( doc.display.aspect );
    Display.render( sample , [
      { kind: "text" , text: Ui.t( "settings.sample_text" ) , pos: [ 0 , 0.15 ] , height: 0.06 , color: doc.display.text_color , wrap: 1.2 },
      { kind: "text" , text: "+" , pos: [ 0 , -0.05 ] , height: 0.08 , color: doc.display.text_color , wrap: 1 },
    ] , { background: doc.display.background , font: doc.display.font } );
    const body = display.querySelector( ".card-body" );
    body.appendChild( Dom.el( "div" , { class: "settings-sample mt-3" , children: [ sample ] } ) );
    body.appendChild( Ui.muted( Ui.t( "settings.units_help" ) , "mt-2 mb-0" ) );
  },
};
