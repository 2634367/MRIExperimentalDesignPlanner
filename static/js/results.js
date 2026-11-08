// The Results screen: how each run brought back went, from the runner's own
// record of it. A local launch adds its runs when PsychoPy exits; a bundle's
// come back through Add run results. The verdict and its reasons are the
// server's (app/models/results.py), so every run is judged the same way:
//
//   ok      on time, finished, pulses as planned
//   check   worth a look: late screens, dropped frames, a silent scanner
//   bad     not usable as it stands: stopped, failed, paused, or the pulses
//           do not cover the run
//
// Where a phase has an Expected key, answers are scored too: per run in the
// table, and per participant or trial type under it.
//
// Not on a share link: the list names participants, and only editors see it.
const Results = {
  name: "results",
  rows: null,         // the last answer, for the experiment in rowsFor
  rowsFor: "",
  participant: "",    // the filter; "" for everyone
  asked: 0,

  // Fetch again; repaint only when something changed, so following other
  // people's edits does not flash the table.
  async load() {
    const id = Doc.id;
    const asked = ( this.asked += 1 );
    try {
      const row = await Api.results( id );
      if ( asked !== this.asked || id !== Doc.id ) return;
      const changed = this.rowsFor !== id || JSON.stringify( row.runs ) !== JSON.stringify( this.rows );
      this.rows = row.runs;
      this.rowsFor = id;
      if ( changed ) Designer.repaint( this.name );
    } catch ( error ) {
      if ( asked === this.asked ) Dom.toast( error.message , "error" );
    }
  },

  render( root ) {
    const t = ( key ) => Ui.t( "results." + key );
    root.replaceChildren( Ui.muted( t( "description" ) ) );
    const upload = RunDialog.resultsButton( () => this.load() );
    if ( upload ) root.appendChild( Dom.el( "div" , { class: "row-actions mb-3" , children: [ upload ] } ) );
    const fresh = this.rowsFor === Doc.id ? this.rows : null;
    // Asked on every paint, answered once: load() repaints only on news.
    this.load();
    if ( !fresh ) {
      root.appendChild( Ui.muted( t( "loading" ) ) );
      return;
    }
    if ( !fresh.length ) {
      root.appendChild( Ui.empty( t( "none" ) ) );
      return;
    }
    const people = Array.from( new Set( fresh.map( ( r ) => r.participant ) ) ).sort();
    if ( this.participant && !people.includes( this.participant ) ) this.participant = "";
    const shown = fresh.filter( ( r ) => !this.participant || r.participant === this.participant );
    const counts = { ok: 0 , check: 0 , bad: 0 };
    shown.forEach( ( r ) => { counts[ r.level ] += 1; } );
    const tally = Dom.el( "div" , { class: "d-flex flex-wrap align-items-center gap-2 mb-2" , children: [
      Dom.el( "span" , { class: "small" , text: t( "count" ).replace( "{runs}" , shown.length ) } ),
      Dom.badge( t( "level_ok" ) + " " + counts.ok , "success" ),
      Dom.badge( t( "level_check" ) + " " + counts.check , "warning" ),
      Dom.badge( t( "level_bad" ) + " " + counts.bad , "danger" ),
    ] } );
    if ( people.length > 1 ) {
      const filter = Ui.select( this.participant , [ [ "" , t( "everyone" ) ] ].concat( people.map( ( p ) => [ p , p || t( "anon" ) ] ) ) , ( v ) => {
        this.participant = v;
        Designer.repaint( this.name );
      } );
      filter.disabled = false;
      filter.classList.add( "w-auto" , "ms-auto" );
      filter.setAttribute( "aria-label" , t( "participant" ) );
      tally.appendChild( filter );
    }
    root.appendChild( tally );
    root.appendChild( this.table( shown ) );
    root.appendChild( Ui.muted( t( "legend" ) , "mt-2" ) );
    const behaviour = this.behaviour( shown );
    if ( behaviour ) root.appendChild( behaviour );
  },

  // Accuracy and mean RT of correct answers, as "a / b correct (p%)".
  percent( tally ) {
    return tally.scored ? Math.round( 100 * tally.correct / tally.scored ) + "%" : "–";
  },

  meanRt( tally ) {
    return tally.rt_n ? Math.round( tally.rt_ms_total / tally.rt_n ) + " ms" : "–";
  },

  scoreCell( r ) {
    const t = ( key ) => Ui.t( "results." + key );
    if ( !r.scored ) return Dom.el( "td" , { class: "small text-body-secondary" , text: t( "not_scored" ) } );
    return Dom.el( "td" , { class: "text-nowrap" , children: [
      Dom.el( "div" , { text: r.correct + " / " + r.scored + " (" + this.percent( r ) + ")" } ),
      Dom.el( "div" , { class: "small text-body-secondary" , text: t( "rt_missed" ).replace( "{rt}" , this.meanRt( r ) ).replace( "{missed}" , r.missed ) } ),
    ] } );
  },

  // Behaviour across the runs listed, leaving out pilots and paused runs,
  // whose answers are someone checking the task: one row per participant,
  // or per trial type once a single participant is showing.
  behaviour( rows ) {
    const t = ( key ) => Ui.t( "results." + key );
    const counted = rows.filter( ( r ) => r.scored && !r.pilot && !r.pauses );
    if ( !counted.length ) return null;
    const people = new Set( counted.map( ( r ) => r.participant ) );
    const byPerson = people.size > 1;
    const groups = {};
    const add = ( name , tally , run ) => {
      const g = groups[ name ] || ( groups[ name ] = { scored: 0 , correct: 0 , missed: 0 , rt_ms_total: 0 , rt_n: 0 , runs: new Set() } );
      [ "scored" , "correct" , "missed" , "rt_ms_total" , "rt_n" ].forEach( ( k ) => { g[ k ] += tally[ k ]; } );
      g.runs.add( run );
    };
    counted.forEach( ( r ) => {
      if ( byPerson ) add( r.participant || t( "anon" ) , r , r.run );
      else Object.keys( r.by_trial_type || {} ).forEach( ( name ) => add( name || t( "no_trial_type" ) , r.by_trial_type[ name ] , r.run ) );
    } );
    const table = Dom.el( "table" , { class: "table table-sm align-middle table-numbers" } );
    const head = [ byPerson ? "col_participant" : "col_trial_type" , "col_runs" , "col_scored" , "col_accuracy" , "col_missed" , "col_rt" ];
    table.appendChild( Dom.el( "thead" , { children: [ Dom.el( "tr" , { children: head.map( ( k ) => Dom.el( "th" , { text: t( k ) } ) ) } ) ] } ) );
    const body = Dom.el( "tbody" );
    Object.keys( groups ).sort().forEach( ( name ) => {
      const g = groups[ name ];
      body.appendChild( Dom.el( "tr" , { children: [
        Dom.el( "td" , { text: name } ), Dom.el( "td" , { text: String( g.runs.size ) } ), Dom.el( "td" , { text: String( g.scored ) } ),
        Dom.el( "td" , { text: g.correct + " (" + this.percent( g ) + ")" } ), Dom.el( "td" , { text: String( g.missed ) } ), Dom.el( "td" , { text: this.meanRt( g ) } ),
      ] } ) );
    } );
    table.appendChild( body );
    const who = byPerson ? t( "behaviour_everyone" ) : t( "behaviour_one" ).replace( "{participant}" , counted[ 0 ].participant || t( "anon" ) );
    return Ui.section( t( "behaviour" ) , [ Dom.el( "div" , { class: "table-responsive" , children: [ table ] } ) ] , { help: who , extra: "mt-3" } );
  },

  table( rows ) {
    const t = ( key ) => Ui.t( "results." + key );
    const head = [ "when" , "participant" , "run" , "shown" , "score" , "onsets" , "frames" , "pulses" , "verdict" , "" ];
    const table = Dom.el( "table" , { class: "table table-sm align-middle results-table" } );
    table.appendChild( Dom.el( "thead" , { children: [ Dom.el( "tr" , { children: head.map( ( key ) => Dom.el( "th" , { text: key ? t( "col_" + key ) : "" } ) ) } ) ] } ) );
    const body = Dom.el( "tbody" );
    rows.forEach( ( r ) => body.appendChild( this.row( r ) ) );
    table.appendChild( body );
    return Dom.el( "div" , { class: "table-responsive" , children: [ table ] } );
  },

  row( r ) {
    const t = ( key ) => Ui.t( "results." + key );
    const ms = ( v ) => ( v == null ? "–" : v.toFixed( 1 ) );
    const when = r.started ? new Date( r.started ) : null;
    const tags = [];
    if ( r.pilot ) tags.push( Dom.badge( t( "tag_pilot" ) , "info" ) );
    if ( r.debug ) tags.push( Dom.badge( t( "tag_debug" ) , "info" ) );
    if ( r.scanner_mode && r.scanner_mode !== "wait" ) tags.push( Dom.badge( t( "tag_" + r.scanner_mode ) || r.scanner_mode , "secondary" ) );
    const run = Dom.el( "td" , { children: [ Dom.el( "div" , { class: "fw-semibold text-nowrap" , text: r.label } ) ] } );
    if ( r.visit ) run.appendChild( Dom.el( "div" , { class: "small text-body-secondary" , text: t( "visit" ).replace( "{visit}" , r.visit ) } ) );
    if ( tags.length ) run.appendChild( Dom.el( "div" , { class: "d-flex flex-wrap gap-1 mt-1" , children: tags } ) );
    const pulses = r.pulses_expected != null
      ? r.pulses_seen + " / " + r.pulses_expected + ( r.pulse_gaps ? " · " + t( "gaps" ).replace( "{gaps}" , r.pulse_gaps ) : "" )
      : "–";
    const tone = { ok: "success" , check: "warning" , bad: "danger" }[ r.level ];
    const verdict = Dom.el( "td" , { children: [ Dom.badge( t( "level_" + r.level ) , tone ) ] } );
    r.reasons.forEach( ( reason ) => verdict.appendChild( Dom.el( "div" , { class: "small" , text: this.reason( reason , r ) } ) ) );
    const remove = Ui.icon( "x-lg" , t( "remove" ) , async () => {
      if ( !( await Dom.confirm( t( "remove_confirm" ).replace( "{run}" , r.label ) ) ) ) return;
      try {
        await Api.removeResult( Doc.id , r.run );
        this.load();
      } catch ( error ) {
        Dom.toast( error.message , "error" );
      }
    } );
    remove.classList.add( "btn-sm" );
    return Dom.el( "tr" , { children: [
      Dom.el( "td" , { class: "small" , attrs: { title: r.ended ? t( "ended" ).replace( "{when}" , new Date( r.ended ).toLocaleString() ) : "" } , children: when ? [
        Dom.el( "div" , { class: "text-nowrap" , text: when.toLocaleDateString() } ),
        Dom.el( "div" , { class: "text-nowrap text-body-secondary" , text: when.toLocaleTimeString( [] , { hour: "2-digit" , minute: "2-digit" } ) } ),
      ] : [ Dom.el( "span" , { text: "–" } ) ] } ),
      Dom.el( "td" , { text: r.participant || t( "anon" ) } ),
      run,
      Dom.el( "td" , { class: "text-nowrap" , children: [
        Dom.el( "div" , { text: r.segments + " / " + r.planned_segments } ),
        Dom.el( "div" , { class: "small text-body-secondary" , text: t( "responses" ).replace( "{n}" , r.responses ) } ),
      ] } ),
      this.scoreCell( r ),
      Dom.el( "td" , { class: "text-nowrap" , text: ms( r.onset_error_ms ) + " / " + ms( r.worst_onset_ms ) + " ms" } ),
      Dom.el( "td" , { class: "text-nowrap" , children: [
        Dom.el( "div" , { text: t( "dropped" ).replace( "{n}" , r.dropped_frames ) } ),
        Dom.el( "div" , { class: "small text-body-secondary" , text: t( "worst_frame" ).replace( "{ms}" , ms( r.worst_frame_ms ) ).replace( "{frame}" , ms( r.frame_ms ) ) } ),
      ] } ),
      Dom.el( "td" , { class: "text-nowrap" , text: pulses } ),
      verdict,
      Dom.el( "td" , { class: "text-end" , children: [ remove ] } ),
    ] } );
  },

  reason( code , r ) {
    const text = Ui.t( "results.reason_" + code );
    if ( code === "failed" ) return text + ( r.error ? ": " + r.error : "" );
    if ( code === "paused" ) return text.replace( "{n}" , r.pauses );
    if ( code === "pulses" ) return text.replace( "{seen}" , r.pulses_seen ).replace( "{expected}" , r.pulses_expected );
    return text;
  },
};
