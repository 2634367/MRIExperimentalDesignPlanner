// The Sessions screen. A session is one visit to the scanner: a list of
// steps -- runs, other scans (a T1, a field map: just their minutes), and
// breaks or setup time. Its count is how many of these each participant
// does; Overview multiplies that out against the hours you have.
//
// Running a session plays all of its runs in order, drawn together, so
// prompt items are not repeated within the session.
const Sessions = {
  name: "sessions",
  selected: null,

  current() {
    const all = Doc.doc.sessions;
    if ( !all.some( ( s ) => s.id === this.selected ) ) this.selected = all.length ? all[ 0 ].id : null;
    return all.find( ( s ) => s.id === this.selected ) || null;
  },

  focus( id ) {
    this.selected = id;
  },

  // What the address names an item by (Nav.url): its name.
  items() {
    return Doc.doc.sessions;
  },

  edit( label , fn , options ) {
    const id = this.selected;
    Doc.change( label , ( d ) => {
      const session = d.sessions.find( ( s ) => s.id === id );
      if ( session ) fn( session , d );
    } , options );
  },

  render( root ) {
    const doc = Doc.doc;
    root.replaceChildren();
    root.appendChild( Ui.muted( Ui.t( "sessions.description" ) ) );
    const session = this.current();
    const add = Ui.button( Ui.t( "sessions.new" ) , "plus-lg" , () => {
      const fresh = Schema.session( Doc.nextName( "sessions" , "sessions.default_name" ) , doc.runs.length ? doc.runs[ 0 ].id : "" );
      Doc.change( Ui.t( "undo.session_added" ) , ( d ) => d.sessions.push( fresh ) );
      this.selected = fresh.id;
      Designer.refresh();
    } , { variant: "btn-outline-primary" , small: true , editOnly: true } );
    // A compact row of chips above the editor, which gets the full width.
    root.appendChild( Ui.picker( doc.sessions.map( ( s ) => ( { id: s.id , name: s.name , meta: Timing.clock( Timing.session( doc , s ).seconds.mean ) } ) ) , this.selected , ( id ) => {
      this.selected = id;
      Designer.refresh();
    } , { unnamed: Ui.t( "sessions.unnamed" ) , chips: true , add: add } ) );
    root.appendChild( session ? this.editor( session ) : Ui.empty( Ui.t( "sessions.none" ) ) );
  },

  // What a scan or break step is: its name, and for a scan the scanner card
  // it uses, whose duration becomes its minutes.
  stepWhat( step , key , editStep ) {
    const name = Ui.text( step.name , ( v ) => editStep( Ui.t( "undo.step_changed" ) , ( st ) => { st.name = v; } ) , { key: key + ".name" , placeholder: Ui.t( "sessions.step_name_" + step.kind ) } );
    if ( step.kind !== "scan" ) return name;
    const take = ( st , card ) => {
      const previous = st.card ? st.card.label : "";
      st.card = card ? Scanners.ref( card ) : null;
      if ( !st.card ) return;
      if ( st.card.seconds > 0 ) st.minutes = Math.round( st.card.seconds / 60 * 100 ) / 100;
      if ( !st.name || st.name === previous || st.name === st.card.id ) st.name = st.card.label;
    };
    const card = Scanners.select( step.card ? step.card.id : "" , Ui.t( "scanners.none_step" ) , ( v ) => editStep( Ui.t( "undo.card_linked" ) , ( st ) => take( st , Scanners.byId( v ) ) ) , { key: key + ".card" } );
    card.setAttribute( "aria-label" , Ui.t( "scanners.step_card" ) );
    const wrap = Dom.el( "div" , { class: "step-scan" , children: [ card , name ] } );
    if ( Scanners.stale( step.card ) ) {
      wrap.appendChild( Ui.button( Ui.t( "scanners.update" ) , "arrow-repeat" , () => editStep( Ui.t( "undo.card_linked" ) , ( st ) => take( st , Scanners.byId( st.card && st.card.id ) ) ) , { small: true , variant: "btn-outline-warning" , editOnly: true , title: Ui.t( "scanners.update_title" ) } ) );
    }
    return wrap;
  },

  // A handle to drag a step to another place. Pointer events rather than
  // HTML drag and drop, so a finger works too; the arrows do the same from
  // the keyboard.
  grip( row , list , session , step ) {
    const grip = Dom.el( "span" , { class: "step-grip" , attrs: { title: Ui.t( "sessions.drag" ) , "aria-hidden": "true" } , children: [ Dom.el( "i" , { class: "bi bi-grip-vertical" } ) ] } );
    grip.addEventListener( "pointerdown" , ( down ) => {
      down.preventDefault();
      grip.setPointerCapture( down.pointerId );
      const rows = Array.from( list.querySelectorAll( ".step-real" ) );
      const from = rows.indexOf( row );
      let before = from;
      const clear = () => rows.forEach( ( r ) => r.classList.remove( "step-drop-before" , "step-drop-after" ) );
      row.classList.add( "step-dragging" );
      const move = ( event ) => {
        const found = rows.findIndex( ( r ) => { const box = r.getBoundingClientRect(); return event.clientY < box.top + box.height / 2; } );
        before = found < 0 ? rows.length : found;
        clear();
        if ( before < rows.length ) rows[ before ].classList.add( "step-drop-before" );
        else rows[ rows.length - 1 ].classList.add( "step-drop-after" );
      };
      const end = ( event ) => {
        grip.removeEventListener( "pointermove" , move );
        grip.removeEventListener( "pointerup" , end );
        grip.removeEventListener( "pointercancel" , end );
        clear();
        row.classList.remove( "step-dragging" );
        const to = before > from ? before - 1 : before;
        if ( event.type === "pointerup" && to !== from ) {
          this.edit( Ui.t( "undo.step_moved" ) , ( s ) => {
            const target = s.steps.find( ( x ) => x.id === step.id );
            s.steps.splice( s.steps.indexOf( target ) , 1 );
            s.steps.splice( to , 0 , target );
          } );
        }
      };
      grip.addEventListener( "pointermove" , move );
      grip.addEventListener( "pointerup" , end );
      grip.addEventListener( "pointercancel" , end );
    } );
    return grip;
  },

  editor( session ) {
    const doc = Doc.doc;
    const info = Timing.session( doc , session );
    const box = Dom.el( "div" );
    const about = [ Ui.row( [
      Ui.field( "sessions.name" , Ui.text( session.name , ( v ) => this.edit( Ui.t( "undo.session_renamed" ) , ( s ) => { s.name = v.trim(); } ) , { key: "ses.name" } ) , { col: "col-md-5" } ),
      Ui.field( "sessions.count" , Ui.number( session.count , ( v ) => this.edit( Ui.t( "undo.session_changed" ) , ( s ) => { s.count = Math.max( 0 , Math.round( v ) ); } ) , { key: "ses.count" , min: 0 , step: 1 } ) , { col: "col-md-3" , help: Ui.t( "sessions.count_help" ) } ),
      Ui.field( "sessions.notes" , Ui.text( session.notes , ( v ) => this.edit( Ui.t( "undo.session_changed" ) , ( s ) => { s.notes = v; } ) , { key: "ses.notes" } ) , { col: "col-md" } ),
    ] ) ];
    about.push( Ui.row( [
      Ui.field( "sessions.auto_break" , Dom.el( "div" , { class: "input-group" , children: [
        Ui.number( session.auto_break_minutes , ( v ) => this.edit( Ui.t( "undo.session_changed" ) , ( s ) => { s.auto_break_minutes = Math.max( 0 , v ); } ) , { key: "ses.autobreak" , min: 0 , step: 0.5 } ),
        Dom.el( "span" , { class: "input-group-text" , text: Ui.t( "sessions.minutes" ) } ),
      ] } ) , { col: "col-md-5" , help: Ui.t( "sessions.auto_break_help" ) } ),
    ] , "mt-1" ) );
    box.appendChild( Ui.section( Ui.t( "sessions.section_session" ) , about , { fold: "sessions.about" } ) );

    const stats = Dom.el( "div" , { class: "stat-row" } );
    const stat = ( label , value , sub ) => stats.appendChild( Dom.el( "div" , { class: "stat" , children: [
      Dom.el( "div" , { class: "stat-label" , text: label } ), Dom.el( "div" , { class: "stat-value" , text: value } ), Dom.el( "div" , { class: "stat-sub" , text: sub || "" } ),
    ] } ) );
    stat( Ui.t( "sessions.stat_length" ) , Timing.clock( info.seconds.mean ) , info.seconds.max > info.seconds.min ? Timing.clock( info.seconds.min ) + "–" + Timing.clock( info.seconds.max ) : "" );
    stat( Ui.t( "sessions.stat_runs" ) , String( info.runs ) , "" );
    const data = Timing.sessionData( doc , session );
    stat( Ui.t( "sessions.stat_data" ) , data.bytes ? Timing.size( data.bytes ) : "–" , data.unsized ? Ui.t( "sessions.stat_data_unsized" ).replace( "{n}" , data.unsized ) : Ui.t( "sessions.stat_data_sub" ) );
    stat( Ui.t( "sessions.stat_trials" ) , String( info.trials ) , Object.keys( info.counts ).map( ( id ) => ( Timing.trialTypeById( doc , id ) || {} ).name + " " + info.counts[ id ] ).join( " · " ) );
    const play = Ui.button( Ui.t( "run.play_session" ) , "play-fill" , () => RunDialog.open( {
      title: session.name || Ui.t( "sessions.unnamed" ) , kind: "session",
      build: ( options ) => Compile.sessionPlans( Doc.doc , { id: Doc.id } , session.id , options ),
    } ) , { variant: "btn-primary" , small: true , disabled: info.runs === 0 } );
    box.appendChild( Ui.section( Ui.t( "sessions.section_length" ) , stats , { actions: [ play ] , fold: "sessions.length" } ) );

    // One grid row per step: grip | start | kind | what | minutes | times |
    // length + actions.
    // In a narrow editor the minutes and actions drop to a second line
    // instead of squeezing the name to nothing (see .step-row).
    const list = Dom.el( "div" , { class: "step-list" } );
    list.appendChild( Dom.el( "div" , { class: "step-row step-head small text-body-secondary" , children: [
      Dom.el( "span" , { class: "step-start" , text: Ui.t( "sessions.col_start" ) } ),
      Dom.el( "span" , { class: "step-kind" , text: Ui.t( "sessions.col_kind" ) } ),
      Dom.el( "span" , { class: "step-what" , text: Ui.t( "sessions.col_what" ) } ),
      Dom.el( "span" , { class: "step-min" , text: Ui.t( "sessions.col_minutes" ) } ),
      Dom.el( "span" , { class: "step-rep" , text: Ui.t( "sessions.col_repeat" ) } ),
      Dom.el( "span" , { class: "step-tail" , text: Ui.t( "sessions.col_length" ) } ),
    ] } ) );
    let clock = 0;
    const autoBreak = session.auto_break_minutes * 60;
    let previous = null;
    session.steps.forEach( ( step , index ) => {
      const key = "st." + step.id;
      const on = step.enabled !== false;
      if ( on && autoBreak > 0 && step.kind === "run" && previous && previous.kind === "run" ) {
        list.appendChild( Dom.el( "div" , { class: "step-row step-auto small text-body-secondary" , children: [
          Dom.el( "span" , { class: "step-start" , text: Timing.clock( clock ) } ),
          Dom.el( "span" , { class: "step-kind" , text: Ui.t( "sessions.kind_break" ) } ),
          Dom.el( "span" , { class: "step-what fst-italic" , text: Ui.t( "sessions.auto_break_row" ) } ),
          Dom.el( "span" , { class: "step-min" } ),
          Dom.el( "span" , { class: "step-rep" } ),
          Dom.el( "div" , { class: "step-tail" , children: [ Dom.el( "span" , { class: "step-length small" , text: Timing.clock( autoBreak ) } ) ] } ),
        ] } ) );
        clock += autoBreak;
      }
      const editStep = ( label , fn ) => this.edit( label , ( s ) => {
        const target = s.steps.find( ( x ) => x.id === step.id );
        if ( target ) fn( target , s );
      } );
      let seconds = step.minutes * 60;
      const kind = Ui.select( step.kind , Schema.STEP_KINDS.map( ( k ) => [ k , Ui.t( "sessions.kind_" + k ) ] ) , ( v ) => editStep( Ui.t( "undo.step_changed" ) , ( st ) => {
        st.kind = v;
        if ( v === "run" && !st.run && Doc.doc.runs.length ) st.run = Doc.doc.runs[ 0 ].id;
      } ) , { key: key + ".kind" } );
      kind.setAttribute( "aria-label" , Ui.t( "sessions.col_kind" ) );
      let what;
      let minutes = Dom.el( "span" );
      if ( step.kind === "run" ) {
        const options = doc.runs.map( ( r ) => [ r.id , r.name || Ui.t( "runs.unnamed" ) ] );
        if ( !doc.runs.some( ( r ) => r.id === step.run ) ) options.unshift( [ step.run , Ui.t( "sessions.missing_run" ) ] );
        what = Ui.select( step.run , options , ( v ) => editStep( Ui.t( "undo.step_changed" ) , ( st ) => { st.run = v; } ) , { key: key + ".run" } );
        const run = doc.runs.find( ( r ) => r.id === step.run );
        seconds = run ? Timing.run( doc , run ).total.mean : 0;
      } else {
        what = this.stepWhat( step , key , editStep );
        // A scan whose card gives its length: the card decides, so there is
        // nothing to type (pick "None" as the card to set minutes by hand).
        minutes = step.card && step.card.seconds > 0
          ? Dom.el( "span" , { class: "small text-body-secondary" , text: Ui.t( "sessions.from_card" ) } )
          : Dom.el( "div" , { class: "input-group" , children: [
            Ui.number( step.minutes , ( v ) => editStep( Ui.t( "undo.step_changed" ) , ( st ) => { st.minutes = Math.max( 0 , v ); } ) , { key: key + ".min" , min: 0 , step: 0.5 } ),
            Dom.el( "span" , { class: "input-group-text" , text: Ui.t( "sessions.minutes" ) } ),
          ] } );
      }
      what.setAttribute( "aria-label" , Ui.t( "sessions.col_what" ) );
      // A run repeated has an automatic break between its repeats too.
      const gaps = step.kind === "run" ? ( step.repeat - 1 ) * autoBreak : 0;
      const length = seconds * step.repeat + gaps;
      const repeat = Ui.number( step.repeat , ( v ) => editStep( Ui.t( "undo.step_changed" ) , ( st ) => { st.repeat = Math.max( 1 , Math.round( v ) ); } ) , { key: key + ".rep" , min: 1 , max: 100 , step: 1 } );
      repeat.setAttribute( "aria-label" , Ui.t( "sessions.repeat_label" ) );
      const times = Dom.el( "div" , { class: "input-group" , children: [ Dom.el( "span" , { class: "input-group-text px-1" , text: "×" } ) , repeat ] } );
      const tail = Dom.el( "div" , { class: "step-tail" , children: [ Dom.el( "span" , { class: "step-length small" , text: on ? Timing.clock( length ) : Ui.t( "sessions.step_is_off" ) } ) ] } );
      if ( !Doc.readOnly ) {
        tail.appendChild( Dom.el( "div" , { class: "row-actions flex-nowrap" , children: [
          Ui.icon( on ? "toggle-on" : "toggle-off" , Ui.t( on ? "sessions.switch_off" : "sessions.switch_on" ) , () => editStep( Ui.t( "undo.step_changed" ) , ( st ) => { st.enabled = !on; } ) ),
          Ui.icon( "arrow-up" , Ui.t( "ui.move_up" ) , () => editStep( Ui.t( "undo.step_moved" ) , ( st , s ) => Ui.move( s.steps , s.steps.indexOf( st ) , -1 ) ) , { disabled: index === 0 } ),
          Ui.icon( "arrow-down" , Ui.t( "ui.move_down" ) , () => editStep( Ui.t( "undo.step_moved" ) , ( st , s ) => Ui.move( s.steps , s.steps.indexOf( st ) , 1 ) ) , { disabled: index === session.steps.length - 1 } ),
          Ui.icon( "files" , Ui.t( "ui.duplicate" ) , () => editStep( Ui.t( "undo.step_added" ) , ( st , s ) => {
            s.steps.splice( s.steps.indexOf( st ) + 1 , 0 , Object.assign( JSON.parse( JSON.stringify( st ) ) , { id: Schema.uid( "st" ) } ) );
          } ) ),
          Ui.icon( "trash" , Ui.t( "ui.delete" ) , () => editStep( Ui.t( "undo.step_deleted" ) , ( st , s ) => s.steps.splice( s.steps.indexOf( st ) , 1 ) ) , { variant: "btn-outline-danger" } ),
        ] } ) );
      }
      const row = Dom.el( "div" , { class: "step-row step-real" + ( on ? "" : " step-off" ) , children: [
        Dom.el( "span" , { class: "step-start small text-body-secondary" , text: on ? Timing.clock( clock ) : "" } ),
        Dom.el( "div" , { class: "step-kind" , children: [ kind ] } ),
        Dom.el( "div" , { class: "step-what" , children: [ what ] } ),
        Dom.el( "div" , { class: "step-min" , children: [ minutes ] } ),
        Dom.el( "div" , { class: "step-rep" , children: [ times ] } ),
        tail,
      ] } );
      if ( !Doc.readOnly ) row.prepend( this.grip( row , list , session , step ) );
      list.appendChild( row );
      if ( on ) {
        clock += length;
        previous = step;
      }
    } );
    list.appendChild( Dom.el( "div" , { class: "step-row step-end small" , children: [
      Dom.el( "span" , { class: "step-start fw-semibold" , text: Timing.clock( clock ) } ),
      Dom.el( "span" , { class: "step-kind text-body-secondary" , text: Ui.t( "sessions.end" ) } ),
    ] } ) );
    const steps = [ list ];
    if ( !Doc.readOnly ) {
      const add = Dom.el( "div" , { class: "row-actions mt-2" } );
      Schema.STEP_KINDS.forEach( ( kind ) => add.appendChild( Ui.button( Ui.t( "sessions.add_" + kind ) , "plus" , () => this.edit( Ui.t( "undo.step_added" ) , ( s , d ) => {
        s.steps.push( Schema.step( kind , kind === "run" && d.runs.length ? d.runs[ 0 ].id : "" ) );
      } ) , { small: true } ) ) );
      steps.push( add );
    }
    steps.push( Dom.el( "div" , { class: "mt-2" , children: [ Tables.actions( () => Tables.session( Doc.doc , session ) ) ] } ) );
    box.appendChild( Ui.section( Ui.t( "sessions.steps" ) , steps , { fold: "sessions.steps" } ) );
    box.appendChild( Ui.section( Ui.t( "figures.heading" ) , Charts.figure( ( light , width ) => Figures.session( Doc.doc , session , light , width ) , "session-" + ( session.name || session.id ) ) , { fold: "sessions.figure" } ) );

    const footer = Dom.el( "div" , { class: "row-actions mt-3" } );
    footer.appendChild( Ui.button( Ui.t( "ui.duplicate" ) , "files" , () => {
      const copy = JSON.parse( JSON.stringify( session ) );
      copy.id = Schema.uid( "ses" );
      copy.name = ( session.name || Ui.t( "sessions.unnamed" ) ) + " " + Ui.t( "ui.copy_suffix" );
      copy.steps.forEach( ( st ) => { st.id = Schema.uid( "st" ); } );
      Doc.change( Ui.t( "undo.session_added" ) , ( d ) => d.sessions.push( copy ) );
      this.selected = copy.id;
      Designer.refresh();
    } , { editOnly: true } ) );
    footer.appendChild( Ui.button( Ui.t( "ui.delete" ) , "trash" , () => {
      Doc.change( Ui.t( "undo.session_deleted" ) , ( d ) => { d.sessions = d.sessions.filter( ( s ) => s.id !== session.id ); } , { toast: true } );
    } , { variant: "btn-outline-danger" , editOnly: true } ) );
    box.appendChild( footer );
    return box;
  },
};
