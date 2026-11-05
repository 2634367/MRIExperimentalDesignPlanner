// Every table of a design as data -- { id, title, columns[], rows[[cell]] }
// -- so the same table can be shown on a screen, copied as Markdown or into
// Word, and written to the report (static/js/report.js and the server's
// report.xlsx). Cells are strings or numbers, already formatted.
const Tables = {
  t( key ) {
    return I18n.get( "tables." + key );
  },

  // -- output ---------------------------------------------------------------

  // A cell may be { text, color }: a colour swatch on screen, the text alone
  // everywhere else.
  text( c ) {
    return c != null && typeof c === "object" ? c.text : c;
  },

  markdown( table ) {
    const cell = ( v ) => String( this.text( v ) == null ? "" : this.text( v ) ).replace( /\|/g , "\\|" ).replace( /\n/g , " " );
    const lines = [ "| " + table.columns.map( cell ).join( " | " ) + " |" , "|" + table.columns.map( () => " --- |" ).join( "" ) ];
    table.rows.forEach( ( row ) => lines.push( "| " + row.map( cell ).join( " | " ) + " |" ) );
    return lines.join( "\n" ) + "\n";
  },

  html( table ) {
    const esc = ( v ) => String( this.text( v ) == null ? "" : this.text( v ) ).replace( /&/g , "&amp;" ).replace( /</g , "&lt;" ).replace( />/g , "&gt;" );
    const td = "border:1px solid #999;padding:3px 6px;";
    return "<table style=\"border-collapse:collapse;font-family:Calibri,Arial,sans-serif;font-size:10pt\">"
      + "<caption style=\"text-align:left;font-weight:bold;padding-bottom:4px\">" + esc( table.title ) + "</caption>"
      + "<thead><tr>" + table.columns.map( ( c ) => "<th style=\"" + td + "background:#eee;text-align:left\">" + esc( c ) + "</th>" ).join( "" ) + "</tr></thead>"
      + "<tbody>" + table.rows.map( ( r ) => "<tr>" + r.map( ( c ) => "<td style=\"" + td + "\">" + esc( c ) + "</td>" ).join( "" ) + "</tr>" ).join( "" ) + "</tbody></table>";
  },

  async copyMarkdown( tables ) {
    const text = [].concat( tables ).map( ( t ) => "**" + t.title + "**\n\n" + this.markdown( t ) ).join( "\n" );
    await this.write( text , null );
  },

  // Rich HTML for Word and Google Docs, with the Markdown as plain text for
  // anywhere else.
  async copyWord( tables ) {
    const list = [].concat( tables );
    await this.write( list.map( ( t ) => this.markdown( t ) ).join( "\n" ) , list.map( ( t ) => this.html( t ) ).join( "<p></p>" ) );
  },

  async write( text , html ) {
    try {
      if ( html && window.ClipboardItem ) {
        await navigator.clipboard.write( [ new ClipboardItem( {
          "text/html": new Blob( [ html ] , { type: "text/html" } ),
          "text/plain": new Blob( [ text ] , { type: "text/plain" } ),
        } ) ] );
      } else {
        await navigator.clipboard.writeText( text );
      }
      Dom.toast( I18n.get( "ui.copied" ) , "ok" );
    } catch ( error ) {
      // No clipboard (plain http): show it to copy by hand.
      const area = Dom.el( "textarea" , { class: "form-control font-monospace small" , attrs: { rows: "12" , readonly: "" } } );
      area.value = text;
      Ui.dialog( { title: this.t( "copy_by_hand" ) , body: area , buttons: [ { text: I18n.get( "nav.close" ) } ] , onShow: () => area.select() } );
    }
  },

  actions( table ) {
    const make = () => ( typeof table === "function" ? table() : table );
    return Dom.el( "div" , { class: "row-actions table-actions" , children: [
      Ui.button( this.t( "copy_markdown" ) , "markdown" , () => this.copyMarkdown( make() ) , { small: true } ),
      Ui.button( this.t( "copy_word" ) , "file-earmark-word" , () => this.copyWord( make() ) , { small: true } ),
    ] } );
  },

  cell( c ) {
    const text = this.text( c );
    const td = Dom.el( "td" , { text: text == null ? "" : String( text ) } );
    if ( c != null && typeof c === "object" && c.color ) {
      const swatch = Dom.el( "span" , { class: "swatch me-2" } );
      swatch.style.background = c.color;
      td.prepend( swatch );
    }
    return td;
  },

  // A table on screen, with its copy buttons. options.toggle: a line plot
  // whose curve i is row i, so each row gets a checkbox that shows or hides
  // it (kept in step with the plot's legend; never copied).
  view( table , options ) {
    const settings = options || {};
    const plot = settings.toggle;
    const head = Dom.el( "tr" , { children: table.columns.map( ( c ) => Dom.el( "th" , { attrs: { scope: "col" } , text: c } ) ) } );
    const boxes = [];
    const body = Dom.el( "tbody" , { children: table.rows.map( ( r , i ) => {
      const cells = r.map( ( c ) => this.cell( c ) );
      if ( plot && cells.length ) {
        const box = Dom.el( "input" , { class: "form-check-input me-2 curve-toggle" , attrs: { type: "checkbox" , title: I18n.get( "charts.toggle_curve" ) , "aria-label": I18n.get( "charts.toggle_curve" ) } } );
        box.checked = plot.shown( i );
        box.addEventListener( "change" , () => plot.setShown( i , box.checked ) );
        boxes.push( box );
        cells[ 0 ].prepend( box );
      }
      return Dom.el( "tr" , { children: cells } );
    } ) } );
    if ( plot ) plot.onChange( () => boxes.forEach( ( box , i ) => { box.checked = plot.shown( i ); } ) );
    const node = Dom.el( "div" , { class: "data-table" + ( settings.class ? " " + settings.class : "" ) , children: [
      Dom.el( "div" , { class: "table-responsive" , children: [ Dom.el( "table" , { class: "table table-sm align-middle mb-1" , children: [ Dom.el( "thead" , { children: [ head ] } ) , body ] } ) ] } ),
      this.actions( table ),
    ] } );
    return node;
  },

  // -- the tables -------------------------------------------------------------

  f( x , digits ) {
    if ( x == null || !Number.isFinite( x ) ) return "–";
    const d = digits == null ? 2 : digits;
    return String( Math.round( x * Math.pow( 10 , d ) ) / Math.pow( 10 , d ) );
  },

  durationText( d , tr ) {
    const span = Timing.span( d , tr );
    return d.kind === "fixed" ? this.f( d.value ) + " s" : this.f( span.min ) + "–" + this.f( span.max ) + " s, " + this.t( "kind_" + d.kind );
  },

  summary( doc ) {
    const budget = Timing.budget( doc );
    const rows = [
      [ this.t( "experiment" ) , doc.name ],
      [ this.t( "tr" ) , doc.scanner.tr + " s" ],
      [ this.t( "dummies" ) , doc.scanner.dummy_volumes ],
      [ this.t( "trial_types" ) , doc.trial_types.length ],
      [ this.t( "runs" ) , doc.runs.length ],
      [ this.t( "sessions" ) , doc.sessions.length ],
      [ this.t( "participants" ) , doc.budget.participants ],
      [ this.t( "hours_per_participant" ) , this.f( budget.perParticipant , 2 ) ],
      [ this.t( "hours_used" ) , this.f( budget.used , 1 ) + " / " + this.f( budget.available , 1 ) ],
    ];
    return { id: "summary" , title: this.t( "summary_title" ) , columns: [ this.t( "item" ) , this.t( "value" ) ] , rows: rows };
  },

  trialTypes( doc ) {
    return {
      id: "trial-types" , title: this.t( "trial_types_title" ) ,
      columns: [ this.t( "trial_type" ) , this.t( "phases" ) , this.t( "mean_s" ) , this.t( "min_s" ) , this.t( "max_s" ) , this.t( "modelled" ) ],
      rows: doc.trial_types.map( ( tt ) => {
        const span = Timing.trial( doc , tt );
        return [ tt.name , tt.phases.map( ( p ) => p.name ).join( " → " ) , this.f( span.mean ) , this.f( span.min ) , this.f( span.max ) ,
          tt.phases.filter( ( p ) => p.modelled ).map( ( p ) => p.name ).join( ", " ) || "–" ];
      } ),
    };
  },

  phases( doc , tt ) {
    let onset = 0;
    return {
      id: "phases-" + tt.id , title: this.t( "phases_title" ).replace( "{name}" , tt.name ) ,
      columns: [ "#" , this.t( "phase" ) , this.t( "duration" ) , this.t( "mean_s" ) , this.t( "onset_s" ) , this.t( "modelled" ) , this.t( "response_keys" ) ],
      rows: tt.phases.map( ( p , i ) => {
        const span = Timing.span( p.duration , doc.scanner.tr );
        const row = [ i + 1 , p.name , this.durationText( p.duration , doc.scanner.tr ) , this.f( span.mean ) , this.f( onset ) , p.modelled ? this.t( "yes" ) : "" , p.response.keys.join( ", " ) ];
        onset += span.mean;
        return row;
      } ),
    };
  },

  // A jittered phase's distribution of waits. Geometric: the exact rungs,
  // with the hazard -- the chance the wait ends on the next TR given it has
  // not ended yet, which stays at p until the cap. Uniform and exponential:
  // the probability of each TR-wide bin.
  jitterRows( doc , d ) {
    const tr = doc.scanner.tr;
    if ( d.kind === "geometric" ) {
      const g = Timing.geometric( d , tr );
      let before = 0;
      return g.probs.map( ( p , n ) => {
        const hazard = 1 - before > 1e-12 ? p / ( 1 - before ) : 1;
        before += p;
        return { wait: d.min + n * tr , p: p , cumulative: before , hazard: hazard };
      } );
    }
    if ( d.kind === "fixed" || d.max <= d.min ) return [];
    const width = d.max - d.min;
    const bins = Math.max( 1 , Math.min( 40 , Math.ceil( width / tr - 1e-9 ) ) );
    const step = width / bins;
    const cdf = ( x ) => {
      if ( d.kind === "uniform" ) return ( x - d.min ) / width;
      const lam = 1 / ( d.scale * width );
      return ( 1 - Math.exp( -lam * ( x - d.min ) ) ) / ( 1 - Math.exp( -lam * width ) );
    };
    let before = 0;
    return Array.from( { length: bins } , ( _ , i ) => {
      const p = cdf( d.min + ( i + 1 ) * step ) - cdf( d.min + i * step );
      const hazard = 1 - before > 1e-12 ? p / ( 1 - before ) : 1;
      before += p;
      return { wait: d.min + i * step , to: d.min + ( i + 1 ) * step , p: p , cumulative: before , hazard: hazard };
    } );
  },

  jitter( doc , tt , phase ) {
    const rows = this.jitterRows( doc , phase.duration );
    const geometric = phase.duration.kind === "geometric";
    return {
      id: "jitter-" + tt.id + "-" + phase.id ,
      title: this.t( "jitter_title" ).replace( "{trial}" , tt.name ).replace( "{phase}" , phase.name ) ,
      columns: [ geometric ? this.t( "trs_extra" ) : this.t( "bin" ) , this.t( "wait_s" ) , this.t( "p_wait" ) , this.t( "running_total" ) , this.t( "hazard" ) ],
      rows: rows.map( ( r , n ) => [
        geometric ? n : n + 1 ,
        geometric ? this.f( r.wait ) : this.f( r.wait ) + "–" + this.f( r.to ) ,
        this.f( r.p * 100 , 1 ) + "%" , this.f( r.cumulative * 100 , 1 ) + "%" , this.f( r.hazard * 100 , 1 ) + "%",
      ] ),
    };
  },

  runs( doc ) {
    return {
      id: "runs" , title: this.t( "runs_title" ) ,
      columns: [ this.t( "run" ) , this.t( "tr" ) , this.t( "trials" ) , this.t( "length" ) , this.t( "range" ) , this.t( "volumes" ) ],
      rows: doc.runs.map( ( run ) => {
        const info = Timing.run( doc , run );
        return [ run.name , info.tr + " s" , info.trials , Timing.clock( info.total.mean ) , Timing.clock( info.total.min ) + "–" + Timing.clock( info.total.max ) ,
          info.volumes.min === info.volumes.max ? info.volumes.min : info.volumes.min + "–" + info.volumes.max ];
      } ),
    };
  },

  // A run part by part, at mean durations.
  runOutline( doc , run ) {
    const info = Timing.run( doc , run );
    const rows = [];
    let clock = 0;
    const add = ( label , seconds , detail ) => {
      if ( seconds <= 0 ) return;
      rows.push( [ Timing.clock( clock ) , label , Timing.clock( seconds ) , detail || "" ] );
      clock += seconds;
    };
    add( I18n.get( "runs.dummies" ) , info.dummy * info.tr , I18n.get( "runs.outline_volumes" ).replace( "{n}" , info.dummy ) );
    add( I18n.get( "runs.lead_in" ) , Timing.leadSpan( run.lead_in , info.tr ).mean );
    let left = run.blocks.reduce( ( n , b ) => n + b.repeat , 0 );
    run.blocks.forEach( ( block , index ) => {
      const blockInfo = info.blocks.find( ( b ) => b.block === block );
      const name = block.name || I18n.get( "runs.block" ) + " " + ( index + 1 );
      const mix = block.mix.map( ( m ) => ( Timing.trialTypeById( doc , m.trial_type ) || {} ).name + " × " + m.count ).join( ", " );
      for ( let r = 0; r < block.repeat; r += 1 ) {
        add( block.repeat > 1 ? name + " (" + ( r + 1 ) + "/" + block.repeat + ")" : name , blockInfo.one.mean , mix );
        left -= 1;
        if ( left > 0 ) add( I18n.get( "runs.rest_short" ) , block.rest_after.seconds );
      }
    } );
    add( I18n.get( "runs.lead_out" ) , Timing.leadSpan( run.lead_out , info.tr ).mean );
    rows.push( [ "" , I18n.get( "runs.outline_total" ) , Timing.clock( info.total.mean ) , "" ] );
    return {
      id: "run-" + run.id , title: this.t( "run_outline_title" ).replace( "{name}" , run.name ) ,
      columns: [ this.t( "start" ) , this.t( "part" ) , this.t( "length" ) , this.t( "detail" ) ], rows: rows,
    };
  },

  session( doc , session ) {
    const rows = [];
    let clock = 0;
    Timing.items( doc , session ).forEach( ( item ) => {
      const what = item.kind === "run" ? ( item.run ? item.run.name : "?" ) : item.auto ? I18n.get( "sessions.auto_break_row" ) : item.step.name;
      rows.push( [ Timing.clock( clock ) , I18n.get( "sessions.kind_" + item.kind ) , what , Timing.clock( item.seconds.mean ) ] );
      clock += item.seconds.mean;
    } );
    rows.push( [ Timing.clock( clock ) , I18n.get( "sessions.end" ) , "" , "" ] );
    return {
      id: "session-" + session.id , title: this.t( "session_title" ).replace( "{name}" , session.name ) ,
      columns: [ this.t( "start" ) , this.t( "kind" ) , this.t( "what" ) , this.t( "length" ) ], rows: rows,
    };
  },

  budget( doc ) {
    const b = Timing.budget( doc );
    const rows = b.rows.map( ( r ) => [ r.session.name , r.session.count , Timing.clock( r.info.seconds.mean ) , this.f( r.hours , 2 ) ] );
    rows.push( [ this.t( "per_participant" ) , "" , "" , this.f( b.perParticipant , 2 ) ] );
    rows.push( [ this.t( "all_participants" ).replace( "{n}" , doc.budget.participants ) , "" , "" , this.f( b.used , 1 ) ] );
    rows.push( [ this.t( "available" ) , "" , "" , this.f( b.available , 1 ) ] );
    return { id: "budget" , title: this.t( "budget_title" ) , columns: [ this.t( "session" ) , this.t( "count" ) , this.t( "length" ) , this.t( "hours" ) ] , rows: rows };
  },

  dataVolume( doc ) {
    const data = Timing.dataVolume( doc );
    const rows = data.rows.map( ( r ) => [ r.session.name , r.runs , r.bytes ? Timing.size( r.bytes ) : "–" , r.session.count , r.bytes ? Timing.size( r.bytes * r.session.count * doc.budget.participants ) : "–" ] );
    rows.push( [ this.t( "per_participant" ) , "" , "" , "" , Timing.size( data.perParticipant ) ] );
    rows.push( [ this.t( "all_participants" ).replace( "{n}" , doc.budget.participants ) , "" , "" , "" , Timing.size( data.total ) ] );
    return {
      id: "data-volume" , title: this.t( "data_title" ) ,
      columns: [ this.t( "session" ) , this.t( "data_runs" ) , this.t( "data_each" ) , this.t( "count" ) , this.t( "data_all" ) ], rows: rows,
    };
  },

  recovery( doc ) {
    const durations = [ 1 , 2 , 3 , 4 , 6 , 8 , 12 ];
    const tolerances = [ 1 , 4 , 10 , 25 , 45 ];
    return {
      id: "hrf-recovery" , title: this.t( "recovery_title" ) ,
      columns: [ this.t( "event_s" ) ].concat( tolerances.map( ( t ) => this.t( "within" ).replace( "{pct}" , t ) ) ),
      rows: durations.map( ( d ) => [ d ].concat( tolerances.map( ( t ) => this.f( Hrf.decayTime( d , t / 100 , doc.hrf ) , 1 ) ) ) ),
    };
  },

  hrf( doc ) {
    return {
      id: "hrf" , title: this.t( "hrf_title" ) , columns: [ this.t( "parameter" ) , this.t( "value" ) ],
      rows: Object.keys( Schema.HRF_DEFAULTS ).map( ( k ) => [ I18n.get( "hrf." + k ) , doc.hrf[ k ] ] ),
    };
  },

  efficiency( result , run ) {
    return {
      id: "efficiency-" + run.id , title: this.t( "efficiency_title" ).replace( "{name}" , run.name ) ,
      columns: [ this.t( "contrast" ) , this.t( "efficiency" ) ],
      rows: result.contrasts.map( ( c ) => [ c.vs ? c.label + " − " + c.vs : c.label + " " + this.t( "vs_baseline" ) , Efficiency.format( c.efficiency ) ] ),
    };
  },

  correlations( result , run ) {
    const names = result.regressors.map( ( r ) => r.label );
    return {
      id: "correlations-" + run.id , title: this.t( "correlations_title" ).replace( "{name}" , run.name ) ,
      columns: [ this.t( "regressor" ) , this.t( "vif" ) ].concat( names ),
      rows: names.map( ( name , i ) => [ name , this.f( result.vif[ i ] , 2 ) ].concat( result.correlations[ i ].map( ( r ) => this.f( r , 2 ) ) ) ),
    };
  },

  // Every table, for the report. Efficiency is measured on each run with
  // the given seed.
  all( doc , seed ) {
    const out = [ this.summary( doc ) , this.budget( doc ) , this.trialTypes( doc ) ];
    doc.trial_types.forEach( ( tt ) => {
      out.push( this.phases( doc , tt ) );
      tt.phases.forEach( ( p ) => { if ( p.duration.kind !== "fixed" ) out.push( this.jitter( doc , tt , p ) ); } );
    } );
    out.push( this.runs( doc ) );
    doc.runs.forEach( ( run ) => out.push( this.runOutline( doc , run ) ) );
    doc.sessions.forEach( ( s ) => out.push( this.session( doc , s ) ) );
    out.push( this.dataVolume( doc ) );
    out.push( this.hrf( doc ) , this.recovery( doc ) );
    if ( Efficiency.regressors( doc ).length ) {
      doc.runs.forEach( ( run ) => {
        const result = Efficiency.run( doc , run , seed );
        if ( !result.regressors.length ) return;
        out.push( this.efficiency( result , run ) );
        if ( result.regressors.length > 1 ) out.push( this.correlations( result , run ) );
      } );
    }
    return out;
  },
};
