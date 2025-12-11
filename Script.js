// script.js
// Ensure you included the required scripts in HTML:
// <script src="https://apis.google.com/js/api.js"></script>
// <script src="https://cdn.jsdelivr.net/npm/@google/earthengine@latest"></script>

// ----------------- GLOBAL VARIABLES -----------------
let map;
let layers = [];
let currentLayer = null;
let eeInitialized = false;
let eeLayerMap = {}; // track Earth Engine tile layers by id

// Chlorophyll-specific globals
const CHL_ROI_ASSET = "projects/floodmodeling-abdulajaz2023/assets/river_only_polygon";
let chlChart = null;
let chlChartData = { labels: [], values: [] };
let selectedChlImage = null; // ee.Image
let selectedChlDate = null; // ee.Date

// Replace with your OAuth Client ID
const CLIENT_ID = "732491930112-j17b0o60it9f1hvm2ie7b2r80gb2h5qe.apps.googleusercontent.com";

// ----------------- INITIALIZATION -----------------
document.addEventListener('DOMContentLoaded', function() {
    initializeMap();
    setupEventListeners();
    renderChlLegend();
});

// Initialize Leaflet Map
function initializeMap() {
    map = L.map('map').setView([29.9, -81.4], 9);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors'
    }).addTo(map);

    map.on('click', onMapClick);
}

// ----------------- AUTHENTICATION -----------------
document.getElementById('authBtn').addEventListener('click', function () {
    if (!eeInitialized) {
        initializeEarthEngine();
    } else {
        showToast('Already authenticated', 'success');
    }
});

function initializeEarthEngine() {
    showLoading(true, 'Initializing Earth Engine...');
    gapi.load('client:auth2', function() {
        gapi.auth2.init({ client_id: CLIENT_ID }).then(function() {
            gapi.auth2.getAuthInstance().signIn().then(function() {
                ee.data.authenticateViaOAuth(CLIENT_ID, function() {
                    ee.initialize(null, null, function() {
                        eeInitialized = true;
                        updateUserStatus();
                        showLoading(false);
                        showToast('Earth Engine initialized successfully!', 'success');
                    }, function(error) {
                        console.error('EE initialize error:', error);
                        showLoading(false);
                        showToast('Failed to initialize Earth Engine: ' + error, 'danger');
                    });
                });
            }).catch(function(err) {
                console.error('Google Sign-In failed', err);
                showLoading(false);
                showToast('Sign-in failed: ' + (err.error || err), 'danger');
            });
        });
    });
}

function updateUserStatus() {
    const userStatus = document.getElementById('userStatus');
    if (eeInitialized) {
        userStatus.textContent = 'Authenticated';
        userStatus.classList.remove('text-light');
        userStatus.classList.add('text-success');
        document.getElementById('authBtn').innerHTML = '<i class="fas fa-sign-out-alt"></i> Sign Out';
    } else {
        userStatus.textContent = 'Not Authenticated';
        userStatus.classList.remove('text-success');
        userStatus.classList.add('text-light');
        document.getElementById('authBtn').innerHTML = '<i class="fas fa-sign-in-alt"></i> Sign In';
    }
}

// ----------------- EVENT LISTENERS -----------------
function setupEventListeners() {
    document.getElementById('loadDataBtn').addEventListener('click', loadData);
    document.getElementById('addLayerBtn').addEventListener('click', addLayer);
    document.getElementById('clearLayersBtn').addEventListener('click', clearLayers);
    document.getElementById('exportBtn').addEventListener('click', exportImage);
    document.getElementById('ndviBtn').addEventListener('click', calculateNDVI);
    document.getElementById('timeSeriesBtn').addEventListener('click', showTimeSeries);
    document.getElementById('statsBtn').addEventListener('click', getStatistics);
    document.getElementById('fullscreenBtn').addEventListener('click', toggleFullscreen);
    document.getElementById('datasetSelect').addEventListener('change', updateVisualizationParams);

    // Chlorophyll buttons
    document.getElementById('chlRunBtn').addEventListener('click', runChlorophyllAnalysis);
    document.getElementById('chlExportBtn').addEventListener('click', exportSelectedChlImage);
}

// ----------------- DATA LOADING & MAP -----------------
function loadData() {
    if (!eeInitialized) {
        showToast('Please initialize Earth Engine first', 'warning');
        return;
    }
    showLoading(true, 'Loading dataset...');

    const dataset = document.getElementById('datasetSelect').value;
    const startDate = document.getElementById('startDate').value;
    const endDate = document.getElementById('endDate').value;
    const visualization = document.getElementById('visSelect').value;

    let eeImage;
    switch (dataset) {
        case 'landsat8':
            eeImage = ee.ImageCollection('LANDSAT/LC08/C02/T1_L2')
                .filterDate(startDate, endDate)
                .filter(ee.Filter.lt('CLOUD_COVER', 20))
                .median();
            break;
        case 'sentinel2':
            eeImage = ee.ImageCollection('COPERNICUS/S2_SR')
                .filterDate(startDate, endDate)
                .filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE', 20))
                .median();
            break;
        case 'modis':
            eeImage = ee.ImageCollection('MODIS/006/MOD13A2')
                .filterDate(startDate, endDate)
                .select('NDVI')
                .median();
            break;
        case 'srtm':
            eeImage = ee.Image('USGS/SRTMGL1_003');
            break;
    }

    if (eeImage) {
        currentLayer = eeImage;
        displayOnMap(eeImage, visualization);
        addToLayerList(dataset, visualization);
        showToast('Data loaded successfully!', 'success');
    }

    showLoading(false);
}

function displayOnMap(image, visualization) {
    clearEeLayers();
    let visParams = getVisualizationParams(visualization);
    image.getMap(visParams, function(mapInfo) {
        const tileUrl = mapInfo.urlFormat;
        const eeTileLayer = L.tileLayer(tileUrl, { attribution: 'Google Earth Engine' }).addTo(map);
        layers.push(eeTileLayer);
        eeLayerMap['layer-' + Date.now()] = eeTileLayer;
    });
}

function getVisualizationParams(visualization) {
    switch (visualization) {
        case 'trueColor':
            return { bands: ['SR_B4','SR_B3','SR_B2'], min:0, max:3000, gamma:1.4 };
        case 'falseColor':
            return { bands: ['SR_B5','SR_B4','SR_B3'], min:0, max:3000, gamma:1.4 };
        case 'ndvi':
            return { bands: ['NDVI'], min:-1, max:1, palette:['blue','white','green'] };
        case 'elevation':
            return { bands: ['elevation'], min:0, max:4000, palette:['blue','green','yellow','red'] };
        default:
            return { bands: ['SR_B4','SR_B3','SR_B2'], min:0, max:3000 };
    }
}

function addToLayerList(name, type) {
    const layerList = document.getElementById('layerList');
    const layerId = 'layer-' + Date.now();
    const layerItem = document.createElement('li');
    layerItem.className = 'list-group-item layer-item';
    layerItem.id = layerId;
    layerItem.innerHTML = `
        <div><strong>${name}</strong><br><small class="text-muted">${type}</small></div>
        <div class="layer-controls">
            <button class="btn btn-sm btn-outline-primary" onclick="toggleLayer('${layerId}')">
                <i class="fas fa-eye"></i>
            </button>
            <button class="btn btn-sm btn-outline-danger" onclick="removeLayer('${layerId}')">
                <i class="fas fa-times"></i>
            </button>
        </div>
    `;
    layerList.appendChild(layerItem);
}

function toggleLayer(layerId) { showToast('Layer visibility toggled','info'); }
function removeLayer(layerId) { const layerElement = document.getElementById(layerId); if(layerElement){ layerElement.remove(); showToast('Layer removed','info'); } }
function clearLayers() { const layerList = document.getElementById('layerList'); layerList.innerHTML=''; layers.forEach(layer=>map.removeLayer(layer)); layers=[]; clearEeLayers(); showToast('All layers cleared','info'); }
function clearEeLayers() { for(const k in eeLayerMap){ try{ map.removeLayer(eeLayerMap[k]); }catch(e){} } eeLayerMap={}; }

// ----------------- ANALYSIS FUNCTIONS -----------------
function calculateNDVI() {
    if(!currentLayer){ showToast('Please load data first','warning'); return; }
    showLoading(true,'Calculating NDVI...');
    const ndvi = currentLayer.normalizedDifference(['SR_B5','SR_B4']).rename('NDVI');
    ndvi.getMap({min:-1,max:1,palette:['red','yellow','green']}, function(mapInfo){
        const tileUrl=mapInfo.urlFormat;
        const ndviLayer=L.tileLayer(tileUrl,{attribution:'NDVI Calculation'}).addTo(map);
        layers.push(ndviLayer);
        addToLayerList('NDVI','Vegetation Index');
        showToast('NDVI calculated successfully!','success');
        showLoading(false);
    });
}

function showTimeSeries(){ showToast('Time Series analysis triggered','info'); }

function getStatistics() {
    if(!currentLayer || !map){ showToast('Please load data and select an area','warning'); return; }
    const bounds=map.getBounds();
    const region=ee.Geometry.Rectangle([bounds.getWest(),bounds.getSouth(),bounds.getEast(),bounds.getNorth()]);
    const stats=currentLayer.reduceRegion({reducer:ee.Reducer.mean(),geometry:region,scale:30,maxPixels:1e9});
    stats.evaluate(function(result){
        let statsHTML='<h6>Statistics:</h6><ul>';
        for(const band in result){ statsHTML+=`<li><strong>${band}:</strong> ${result[band].toFixed(4)}</li>`; }
        statsHTML+='</ul>';
        document.getElementById('infoPanel').innerHTML=statsHTML;
        showToast('Statistics calculated','success');
    });
}

function exportImage() {
    if(!currentLayer){ showToast('No data to export','warning'); return; }
    const bounds=map.getBounds();
    const region=ee.Geometry.Rectangle([bounds.getWest(),bounds.getSouth(),bounds.getEast(),bounds.getNorth()]);
    showToast('Export task created. Check Earth Engine Tasks tab','info');
    try { 
        const task=ee.batch.Export.image.toDrive({image:currentLayer,description:'exported_image_'+Date.now(),scale:30,region:region,maxPixels:1e9}); 
        task.start(); 
    } catch(err){ 
        console.warn('Export may not be available in this environment.',err); 
        showToast('Export task could not start programmatically. Use Code Editor or Tasks.','warning'); 
    }
}

function onMapClick(e){
    const coords=e.latlng;
    document.getElementById('coordinates').innerHTML=`Lat: ${coords.lat.toFixed(4)}, Lng: ${coords.lng.toFixed(4)}`;
    if(currentLayer){
        const point=ee.Geometry.Point([coords.lng,coords.lat]);
        currentLayer.reduceRegion({reducer:ee.Reducer.first(),geometry:point,scale:30}).evaluate(function(result){
            let pixelInfo='<h6>Pixel Values:</h6><ul>';
            for(const band in result){ pixelInfo+=`<li><strong>${band}:</strong> ${result[band]}</li>`; }
            pixelInfo+='</ul>';
            document.getElementById('pixelValue').innerHTML=pixelInfo;
        });
    }
}

function toggleFullscreen(){
    const mapContainer=document.getElementById('map');
    if(!document.fullscreenElement){ if(mapContainer.requestFullscreen) mapContainer.requestFullscreen(); }
    else{ if(document.exitFullscreen) document.exitFullscreen(); }
}

// ----------------- UI HELPERS -----------------
function showLoading(show,text='Loading...'){ const overlay=document.getElementById('loadingOverlay'); const loadingText=document.getElementById('loadingText'); loadingText.textContent=text; overlay.style.display=show?'flex':'none'; }
function showToast(message,type='info'){ const toastContainer=document.getElementById('toastContainer'); const toastId='toast-'+Date.now(); const colorClass=(type==='success'||type==='info'||type==='warning'||type==='danger')?type:'info'; const toastEl=document.createElement('div'); toastEl.className=`toast align-items-center text-white bg-${colorClass} border-0`; toastEl.setAttribute('role','alert'); toastEl.id=toastId; toastEl.innerHTML=`<div class="d-flex"><div class="toast-body">${message}</div><button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast"></button></div>`; toastContainer.appendChild(toastEl); const toast=new bootstrap.Toast(toastEl,{delay:3500}); toast.show(); toastEl.addEventListener('hidden.bs.toast',function(){ toastEl.remove(); }); }

function updateVisualizationParams(){
    const dataset=document.getElementById('datasetSelect').value;
    const visSelect=document.getElementById('visSelect');
    visSelect.innerHTML='';
    const options={landsat8:['True Color','False Color','NDVI','SWIR'],sentinel2:['True Color','False Color','NDVI','NDWI'],modis:['NDVI','EVI','Quality'],srtm:['Elevation','Slope','Aspect']};
    const datasetOptions=options[dataset]||['True Color'];
    datasetOptions.forEach(option=>{
        const opt=document.createElement('option');
        opt.value=option.toLowerCase().replace(' ','');
        opt.textContent=option;
        visSelect.appendChild(opt);
    });
}

// ----------------- CHLOROPHYLL MONITOR -----------------
function getChlROI(){ return ee.FeatureCollection(CHL_ROI_ASSET); }
function getChlorophyllCollection(startDateStr,endDateStr){
    const start=ee.Date(startDateStr); const end=ee.Date(endDateStr);
    return ee.ImageCollection("COPERNICUS/S2_SR_HARMONIZED")
        .filterDate(start,end)
        .filterBounds(getChlROI())
        .filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE',20))
        .map(function(image){
            var ci=image.expression('(B5/B4)-1',{'B5':image.select('B5'),'B4':image.select('B4')}).rename('Chlorophyll_Index');
            return image.addBands(ci.multiply(48).rename('Chlorophyll_Index')).clip(getChlROI()).copyProperties(image,['system:time_start']);
        });
}

function runChlorophyllAnalysis(){
    if(!eeInitialized){ showToast('Please authenticate with Earth Engine first','warning'); return; }
    const startDate=document.getElementById('chlStartDate').value;
    const endDate=document.getElementById('chlEndDate').value;
    if(!startDate||!endDate){ showToast('Please pick start and end dates','warning'); return; }
    showLoading(true,'Generating time series...');
    const collection=getChlorophyllCollection(startDate,endDate);
    const makeFeature=function(img){
        const mean=img.select('Chlorophyll_Index').reduceRegion({reducer:ee.Reducer.mean(),geometry:getChlROI(),scale:500,maxPixels:1e13}).get('Chlorophyll_Index');
        return ee.Feature(null,{'date':img.date().format('YYYY-MM-dd'),'meanCI':mean});
    };
    const features=collection.map(makeFeature).filter(ee.Filter.notNull(['meanCI']));
    features.aggregate_array('date').evaluate(function(dates){
        if(!dates||dates.length===0){ showLoading(false); document.getElementById('chlMessage').textContent='No images found for selected dates (or too cloudy).'; showToast('No images found','warning'); return; }
        features.aggregate_array('meanCI').evaluate(function(values){
            const cleaned=[]; const cleanedDates=[];
            for(let i=0;i<values.length;i++){ if(values[i]!==null && values[i]!==undefined && !isNaN(values[i])){ cleaned.push(values[i]); cleanedDates.push(dates[i]); } }
            if(cleaned.length===0){ showLoading(false); document.getElementById('chlMessage').textContent='All images had no valid CI values.'; showToast('No valid CI values','warning'); return; }
            chlChartData.labels=cleanedDates; chlChartData.values=cleaned; renderChlChart();
            showLoading(false); document.getElementById('chlMessage').textContent='Chart ready. Click a point to load its image.'; showToast('Chlorophyll time series generated','success');
        },function(err){ showLoading(false); console.error('value eval err',err); showToast('Error retrieving chlorophyll values','danger'); });
    },function(err){ showLoading(false); console.error('date eval err',err); showToast('Error retrieving dates','danger'); });
}

function renderChlChart(){
    const ctx=document.getElementById('chlChart').getContext('2d');
    if(chlChart){ chlChart.destroy(); }
    chlChart=new Chart(ctx,{
        type:'line',
        data:{ labels:chlChartData.labels, datasets:[{label:'Mean Chlorophyll Index (CI)',data:chlChartData.values,fill:false,tension:0.2,pointRadius:4,pointHoverRadius:6}] },
        options:{
            maintainAspectRatio:false,
            onClick:function(evt){
                const points=this.getElementsAtEventForMode(evt,'nearest',{intersect:true},true);
                if(points.length){
                    const firstPoint=points[0];
                    const label=this.data.labels[firstPoint.index];
                    loadChlImageForDate(label);
                }
            },
            plugins:{legend:{display:false}},
            scales:{x:{title:{display:true,text:'Date'}},y:{title:{display:true,text:'Mean CI'}}}
        }
    });
}

function loadChlImageForDate(dateStr){
    if(!eeInitialized){ showToast('Authenticate first','warning'); return; }
    const img=getChlorophyllCollection(dateStr,dateStr).first();
    if(!img){ showToast('No image found for '+dateStr,'warning'); return; }
    const vis={min:0,max:48,palette:['blue','lightblue','yellowgreen','red']};
    clearEeLayers();
    img.getMap(vis,function(mapInfo){
        const tileUrl=mapInfo.urlFormat; const eeTile=L.tileLayer(tileUrl,{attribution:'Chlorophyll Index'}).addTo(map);
        const layerId='chl-'+dateStr; eeLayerMap[layerId]=eeTile; layers.push(eeTile);
        addRoiOutlineToMap();
        selectedChlImage=img.select('Chlorophyll_Index'); selectedChlDate=ee.Date(dateStr);
        document.getElementById('chlImagePreview').innerHTML=`<div class="card p-2"><strong>Selected:</strong> ${dateStr}<br/><small>Mean CI: ${getMeanForLabel(dateStr)}</small></div>`;
        showToast('Loaded chlorophyll image for '+dateStr,'success');
    });
}

function getMeanForLabel(dateStr){ const idx=chlChartData.labels.indexOf(dateStr); return idx>=0?chlChartData.values[idx].toFixed(3):'-'; }
function addRoiOutlineToMap(){ if(window._roiLayer){ try{ map.removeLayer(window._roiLayer); }catch(e){} window._roiLayer=null; } const roi=getChlROI(); roi.geometry().getInfo(function(geo){ try{ window._roiLayer=L.geoJSON(geo,{style:{color:'red',weight:2,fill:false}}).addTo(map); map.fitBounds(window._roiLayer.getBounds(),{padding:[20,20]}); }catch(e){ console.warn('Could not add ROI outline',e); } }); }
function exportSelectedChlImage(){
    if(!selectedChlImage||!selectedChlDate){ document.getElementById('chlMessage').textContent='Click a chart point to select an image first.'; showToast('Select an image first','warning'); return; }
    const region=getChlROI().geometry(); const filename='Chlorophyll_Index_'+selectedChlDate.format('YYYY-MM-dd').getInfo();
    const exportTask=ee.batch.Export.image.toDrive({image:selectedChlImage.toFloat(),description:filename,folder:'EarthEngineExports',fileNamePrefix:filename,region:region,scale:500,maxPixels:1e13});
    try{ exportTask.start(); document.getElementById('chlMessage').textContent='Export task created. Check Tasks tab.'; showToast('Export task created. Check the Earth Engine Tasks tab','info'); }
    catch(err){ console.error('Export start error',err); showToast('Could not start export programmatically. Use Code Editor/Tasks.','warning'); }
}

function renderChlLegend(){
    const legendDiv=document.getElementById('chlLegend');
    const palette=['darkblue','blue','lightblue','yellowgreen','orange','red'];
    const ranges=['< -20','-20 to 0','0 to 20','20 to 40','40 to 60','> 60'];
    let html='<strong>Chlorophyll Index (CI) Legend</strong><div class="mt-1 small">';
    for(let i=0;i<palette.length;i++){ html+=`<div style="display:flex;align-items:center;margin:4px 0;"><div style="width:18px;height:14px;background:${palette[i]};border-radius:2px;margin-right:8px;"></div><div>${ranges[i]}</div></div>`; }
    html+='</div>'; legendDiv.innerHTML=html;
}
