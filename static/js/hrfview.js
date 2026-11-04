// The HRF screen: the shape of the response every graph in the app models
// (trial responses, run efficiency, the report), how long an event takes to
// fade, and which phases are modelled. The sliders redraw the curve as they
// move and save when let go.
const HrfView = {
  name: "hrf",

  render( root ) {
    const doc = Doc.doc;
    root.replaceChildren();
    root.appendChild( Ui.muted( Ui.t( "hrf.description" ) ) );

    const row = Dom.el( "div" , { class: "row g-4" } );
    const controls = Dom.el( "div" , { class: "col-lg-4" } );
    const plotCol = Dom.el( "div" , { class: "col-lg-8" } );
    const caption = Dom.el( "div" , { class: "small text-body-secondary mt-1" } );
    let draft = Object.assign( {} , doc.hrf );
    let plot = null;
    const drawPlot = () => {
      plot = this.plot( draft );
      plotCol.replaceChildren( plot.element , caption , Charts.downloads( ( light ) => plot.svg( light ) , "hrf" ) );
      const marks = Hrf.landmarks( draft );
      caption.textContent = Ui.t( "hrf.caption" ).replace( "{peak}" , marks.peak.t.toFixed( 1 ) ).replace( "{trough}" , marks.trough.t.toFixed( 1 ) )
        .replace( "{ratio}" , draft.undershoot_ratio ).replace( "{span}" , draft.span );
    };
    Object.keys( Schema.HRF_DEFAULTS ).forEach( ( field ) => {
      const [ min , max , step ] = Schema.HRF_RANGES[ field ];
      const value = Dom.el( "span" , { class: "hrf-value" , text: String( doc.hrf[ field ] ) } );
      const range = Dom.el( "input" , { class: "form-range" , attrs: { type: "range" , min: String( min ) , max: String( max ) , step: String( step ) , "data-key": "hrf." + field } } );
      range.value = String( doc.hrf[ field ] );
      range.disabled = Doc.readOnly;
      range.id = "hrf_" + field;
      range.addEventListener( "input" , () => {
        draft = Object.assign( {} , draft , { [ field ]: Number( range.value ) } );
        value.textContent = range.value;
        drawPlot();
      } );
      range.addEventListener( "change" , () => Doc.change( Ui.t( "undo.hrf_changed" ) , ( d ) => { d.hrf[ field ] = Number( range.value ); } , { merge: true } ) );
      controls.appendChild( Dom.el( "div" , { class: "mb-2" , children: [
        Dom.el( "label" , { class: "form-label small mb-0 d-flex justify-content-between" , attrs: { for: range.id } , children: [ Dom.el( "span" , { text: Ui.t( "hrf." + field ) } ) , value ] } ),
        range,
        Dom.el( "div" , { class: "form-text mt-0" , text: Ui.t( "hrf." + field + "_help" ) } ),
      ] } ) );
    } );
    const canonical = Object.keys( Schema.HRF_DEFAULTS ).every( ( k ) => doc.hrf[ k ] === Schema.HRF_DEFAULTS[ k ] );
    controls.appendChild( Ui.button( Ui.t( "hrf.reset" ) , "arrow-counterclockwise" , () => Doc.change( Ui.t( "undo.hrf_reset" ) , ( d ) => {
      d.hrf = Object.assign( {} , Schema.HRF_DEFAULTS );
    } , { toast: true } ) , { editOnly: true , disabled: canonical , small: true } ) );
    row.appendChild( controls );
    row.appendChild( plotCol );
    root.appendChild( Ui.section( Ui.t( "hrf.shape" ) , row ) );
    drawPlot();

    // How long an event of each length takes to settle.
    root.appendChild( Ui.section( Ui.t( "hrf.recovery" ) , Tables.view( Tables.recovery( doc ) , { class: "table-numbers" } ) , { help: Ui.t( "hrf.recovery_help" ) } ) );

    // What is modelled.
    const regs = Efficiency.regressors( doc );
    const modelled = Dom.el( "div" );
    if ( !regs.length ) {
      modelled.appendChild( Ui.empty( Ui.t( "hrf.none_modelled" ) ) );
    } else {
      const list = Dom.el( "div" , { class: "list-group" } );
      regs.forEach( ( reg ) => {
        const swatch = Dom.el( "span" , { class: "swatch" } );
        swatch.style.background = reg.trial_type.color;
        const span = Timing.span( reg.phase.duration , doc.scanner.tr );
        list.appendChild( Dom.el( "a" , { class: "list-group-item list-group-item-action d-flex align-items-center gap-2" , attrs: { href: "#trials" } ,
          on: { click: () => Trials.focus( reg.trial_type.id ) } , children: [
            swatch , Dom.el( "span" , { class: "flex-grow-1" , text: reg.label } ),
            Dom.el( "span" , { class: "small text-body-secondary" , text: Timing.describe( span ) + " · " + Ui.t( "hrf.fades_in" ).replace( "{s}" , Hrf.decayTime( span.mean , 0.1 , doc.hrf ).toFixed( 1 ) ) } ),
          ] } ) );
      } );
      modelled.appendChild( list );
    }
    root.appendChild( Ui.section( Ui.t( "hrf.modelled" ) , modelled , { help: Ui.t( "hrf.modelled_help" ) } ) );
  },

  plot( p ) {
    const t = [];
    for ( let x = 0; x <= p.span + 1e-9; x += 0.1 ) t.push( Math.round( x * 10 ) / 10 );
    const marks = Hrf.landmarks( p );
    const scale = marks.peak.v || 1;
    const values = t.map( ( x ) => Hrf.shape( x , p ) / scale );
    return Charts.linePlot( {
      t: t , height: 260 , title: Ui.t( "hrf.shape" ) ,
      series: [ { label: Ui.t( "hrf.response" ) , values: values , width: 2.2 } ],
      vlines: [
        { x: marks.peak.t , label: Ui.t( "hrf.peak_at" ).replace( "{s}" , marks.peak.t.toFixed( 1 ) ) , series: 1 },
        { x: marks.trough.t , label: Ui.t( "hrf.undershoot_at" ).replace( "{s}" , marks.trough.t.toFixed( 1 ) ) , series: 2 , row: 1 },
      ],
    } );
  },
};
