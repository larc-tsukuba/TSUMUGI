// ############################################################################
// Input handling
// ############################################################################


const elements = (function () {
    const req = new XMLHttpRequest();
    let result = null;

    try {
        req.open("GET", "../../data/genesymbol/Rer1.json.gz", false);
        req.overrideMimeType("text/plain; charset=x-user-defined"); // バイナリデータとして扱うための設定
        req.send(null);
        if (req.status === 200) {
            // gzipデータをUint8Arrayに変換
            const compressedData = new Uint8Array(
                req.responseText.split("").map(c => c.charCodeAt(0) & 0xff)
            );
            // pakoでデコード
            const decompressedData = pako.ungzip(compressedData, { to: "string" });
            result = JSON.parse(decompressedData);
        } else {
            console.error("HTTP error!! status:", req.status);
        }
    } catch (error) {
        console.error("Failed to load or decode JSON.gz:", error);
    }

    return result;
})();

const map_symbol_to_id = (function () {
    const req = new XMLHttpRequest();
    let result = null;
    req.onreadystatechange = function () {
        if (req.readyState === 4 && req.status === 200) {
            result = JSON.parse(req.responseText);
        }
    };
    req.open("GET", "../../data/marker_symbol_accession_id.json", false);


    req.send(null);
    return result;
})();


// ############################################################################
// 遺伝型・正特異的フィルタリング関数
// ############################################################################

// フィルターフォームの取得
const filterGenotypeForm = document.getElementById('genotype-filter-form');
const filterSexForm = document.getElementById('sex-filter-form');

// フィルタリング関数（遺伝型 + 性別）
function filterElementsByGenotypeAndSex() {
    const checkedGenotypes = Array.from(filterGenotypeForm.querySelectorAll('input:checked')).map(input => input.value);
    const checkedSexs = Array.from(filterSexForm.querySelectorAll('input:checked')).map(input => input.value);

    // console.log("検索キーワード (Genotype):", checkedGenotypes);
    // console.log("検索キーワード (Sex):", checkedSexs);

    let targetElements;

    // もし checkedSexs に Female と Male の両方が含まれていたら、性別のフィルターを無効にし、遺伝型のフィルターのみ適用
    if (checkedSexs.includes("Female") && checkedSexs.includes("Male")) {
        // console.log("性別フィルター無効（遺伝型のみ適用）");
        targetElements = elements;
    } else {
        targetElements = elements.map(item => {
            if (item.data.annotation) {
                const filteredAnnotations = item.data.annotation.filter(annotation => {
                    const sexMatch = checkedSexs.some(sex => annotation.includes(`${sex}`));
                    return sexMatch;
                });

                return { ...item, data: { ...item.data, annotation: filteredAnnotations } };
            }
            return item;
        }).filter(item => item.data.annotation && item.data.annotation.length > 0);
    }

    // 遺伝型フィルターの適用
    const filteredElements = targetElements.map(item => {
        if (item.data.annotation) {
            const filteredAnnotations = item.data.annotation.filter(annotation => {
                const genotypeMatch = checkedGenotypes.some(genotype => annotation.includes(`${genotype}`));
                return genotypeMatch;
            });

            return { ...item, data: { ...item.data, annotation: filteredAnnotations } };
        }
        return item;
    }).filter(item => item.data.annotation && item.data.annotation.length > 0);

    // Cytoscape のデータを更新
    cy.elements().remove(); // 既存の要素を削除
    cy.add(filteredElements); // 新しい要素を追加
    filterElements(); // 孤立ノードを削除
}

// フォーム変更時にフィルタリング関数を実行
filterGenotypeForm.addEventListener('change', filterElementsByGenotypeAndSex);
filterSexForm.addEventListener('change', filterElementsByGenotypeAndSex);


// ############################################################################
// Normalize node color and edge sizes
// ############################################################################

const nodeSizes = elements.filter(ele => ele.data.node_color !== undefined).map(ele => ele.data.node_color);
const edgeSizes = elements.filter(ele => ele.data.edge_size !== undefined).map(ele => ele.data.edge_size);

const nodeMin = Math.min(...nodeSizes);
const nodeMax = Math.max(...nodeSizes);
const edgeMin = Math.min(...edgeSizes);
const edgeMax = Math.max(...edgeSizes);

function scaleToOriginalRange(value, minValue, maxValue) {
    return minValue + (value - 1) * (maxValue - minValue) / 9;
}

function scaleValue(value, minValue, maxValue, minScale, maxScale) {
    // スケール範囲をminScaleとmaxScaleに合わせて変換
    if (minValue == maxValue) {
        return (maxScale + minScale) / 2;
    }
    return minScale + (value - minValue) * (maxScale - minScale) / (maxValue - minValue);
}

function getColorForValue(value) {
    // value を1-10の範囲から0-1の範囲に変換
    const ratio = (value - 1) / (10 - 1);
    const r1 = 248, g1 = 229, b1 = 140; // Light Yellow
    const r2 = 255, g2 = 140, b2 = 0;   // Orange

    const r = Math.round(r1 + (r2 - r1) * ratio);
    const g = Math.round(g1 + (g2 - g1) * ratio);
    const b = Math.round(b1 + (b2 - b1) * ratio);

    return `rgb(${r}, ${g}, ${b})`;
}

// ############################################################################
// Cytoscape handling
// ############################################################################


function getLayoutOptions() {
    return {
        name: currentLayout,
        nodeRepulsion: nodeRepulsionValue,
        componentSpacing: componentSpacingValue
    };
}

let currentLayout = 'cose';

const nodeRepulsionMin = 1;
const nodeRepulsionMax = 10000;
const componentSpacingMin = 1;
const componentSpacingMax = 200;

let nodeRepulsionValue = scaleToOriginalRange(parseFloat(document.getElementById('nodeRepulsion-slider').value), nodeRepulsionMin, nodeRepulsionMax);
let componentSpacingValue = scaleToOriginalRange(parseFloat(this.value), componentSpacingMin, componentSpacingMax);

const cy = cytoscape({
    container: document.querySelector('.cy'),
    elements: elements,
    style: [
        {
            selector: 'node',
            style: {
                'label': 'data(label)',
                'text-valign': 'center',
                'text-halign': 'center',
                'font-size': '20px',
                'width': 15,
                'height': 15,
                'background-color': function (ele) {
                    const color_value = scaleValue(ele.data('node_color'), nodeMin, nodeMax, 1, 10);
                    return getColorForValue(color_value);
                }
            }
        },
        {
            selector: 'edge',
            style: {
                'curve-style': 'bezier',
                'text-rotation': 'autorotate',
                'width': function (ele) {
                    return scaleValue(ele.data('edge_size'), edgeMin, edgeMax, 0.5, 2);
                }
            }
        }
    ],
    layout: getLayoutOptions()
});


// レイアウトが変更されるか、フィルタリングが実行された際に連結成分を計算する関数
function calculateConnectedComponents() {
    // 表示されている要素のみを取得
    const visibleElements = cy.elements(':visible');

    // 可視状態の要素で連結成分を計算
    const connectedComponents = visibleElements.components();

    let connected_component = connectedComponents.map(component => {
        let componentObject = {};

        // ノードを処理
        component.nodes().forEach(node => {
            const nodeLabel = node.data('label');
            const nodeAnnotations = Array.isArray(node.data('annotation'))
                ? node.data('annotation')
                : [node.data('annotation')]; // annotation が配列でない場合も考慮

            // ノード名をキー、アノテーションを値とするオブジェクトを作成
            componentObject[nodeLabel] = nodeAnnotations;
        });

        return componentObject;
    });

    // 結果をログに出力（デバッグ用）
    // console.log('Connected Components (Formatted):', connected_component);

    // 必要に応じて connected_component を他の場所で利用可能にする
    return connected_component;
}

// レイアウト変更後にイベントリスナーを設定
cy.on('layoutstop', function () {
    calculateConnectedComponents();
});


// ############################################################################
// Visualization handling
// ############################################################################

// --------------------------------------------------------
// Network layout dropdown
// --------------------------------------------------------

document.getElementById('layout-dropdown').addEventListener('change', function () {
    currentLayout = this.value;
    cy.layout({ name: currentLayout }).run();
});

// --------------------------------------------------------
// Initialization of the Slider for Phenotypes similarity
// --------------------------------------------------------
const edgeSlider = document.getElementById('filter-edge-slider');
noUiSlider.create(edgeSlider, {
    start: [1, 10],
    connect: true,
    range: {
        'min': 1,
        'max': 10
    },
    step: 1
});

function filterElements() {
    const edgeSliderValues = edgeSlider.noUiSlider.get().map(parseFloat);

    const edgeMinValue = scaleToOriginalRange(edgeSliderValues[0], edgeMin, edgeMax);
    const edgeMaxValue = scaleToOriginalRange(edgeSliderValues[1], edgeMin, edgeMax);

    cy.nodes().forEach(function (node) {
        node.style('display', 'element');
    });

    // Filter edges based on size
    cy.edges().forEach(function (edge) {
        const edgeSize = edge.data('edge_size');
        const sourceNode = cy.getElementById(edge.data('source'));
        const targetNode = cy.getElementById(edge.data('target'));

        if (sourceNode.style('display') === 'element' && targetNode.style('display') === 'element' &&
            edgeSize >= edgeMinValue && edgeSize <= edgeMaxValue) {
            edge.style('display', 'element');
        } else {
            edge.style('display', 'none');
        }
    });

    // calculateConnectedComponentsを利用して連結成分を取得
    const connected_component = calculateConnectedComponents();

    // node_colorが1のノードを含む連結成分のみを選択
    const componentsWithNodeColor1 = connected_component.filter(component => {
        return Object.keys(component).some(nodeLabel => {
            const node = cy.$(`node[label="${nodeLabel}"]`);
            return node.data('node_color') === 1;
        });
    });

    // すべてのノードとエッジを一旦非表示にする
    cy.nodes().style('display', 'none');
    cy.edges().style('display', 'none');

    // node_colorが1のノードを含む連結成分のみ表示
    componentsWithNodeColor1.forEach(component => {
        Object.keys(component).forEach(nodeLabel => {
            const node = cy.$(`node[label="${nodeLabel}"]`);
            node.style('display', 'element');
            node.connectedEdges().style('display', 'element');
        });
    });

    cy.nodes().forEach(function (node) {
        const connectedEdges = node.connectedEdges().filter(edge => edge.style('display') === 'element');
        if (connectedEdges.length === 0) {
            node.style('display', 'none');  // Hide node if no connected edges
        }
    });

    // Reapply layout after filtering
    cy.layout(getLayoutOptions()).run();
}

// --------------------------------------------------------
// Update the slider values when the sliders are moved
// --------------------------------------------------------

edgeSlider.noUiSlider.on('update', function (values) {
    const intValues = values.map(value => Math.round(value));
    document.getElementById('edge-size-value').textContent = intValues.join(' - ');
    filterElements();
});


// ############################################################################
// Cytoscape's visualization setting
// ############################################################################

// --------------------------------------------------------
// Slider for Font size
// --------------------------------------------------------
const fontSizeSlider = document.getElementById('font-size-slider');
noUiSlider.create(fontSizeSlider, {
    start: 20,
    connect: [true, false],
    range: {
        'min': 1,
        'max': 50
    },
    step: 1
});
fontSizeSlider.noUiSlider.on('update', function (value) {
    const intValues = Math.round(value);
    document.getElementById('font-size-value').textContent = intValues;
    cy.style().selector('node').style('font-size', intValues + 'px').update();
});

// --------------------------------------------------------
// Slider for Edge width
// --------------------------------------------------------
const edgeWidthSlider = document.getElementById('edge-width-slider');
noUiSlider.create(edgeWidthSlider, {
    start: 5,
    connect: [true, false],
    range: {
        'min': 1,
        'max': 10
    },
    step: 1
});
edgeWidthSlider.noUiSlider.on('update', function (value) {
    const intValues = Math.round(value);
    document.getElementById('edge-width-value').textContent = intValues;
    cy.style().selector('edge').style('width', function (ele) {
        return scaleValue(ele.data('edge_size'), edgeMin, edgeMax, 0.5, 2) * intValues;
    }).update();
});

// --------------------------------------------------------
// Slider for Node repulsion
// --------------------------------------------------------
const nodeRepulsionSlider = document.getElementById('nodeRepulsion-slider');
noUiSlider.create(nodeRepulsionSlider, {
    start: 5,
    connect: [true, false],
    range: {
        'min': 1,
        'max': 10
    },
    step: 1
});
nodeRepulsionSlider.noUiSlider.on('update', function (value) {
    const intValues = Math.round(value);
    nodeRepulsionValue = scaleToOriginalRange(parseFloat(intValues), nodeRepulsionMin, nodeRepulsionMax);
    componentSpacingValue = scaleToOriginalRange(parseFloat(intValues), componentSpacingMin, componentSpacingMax);
    document.getElementById('node-repulsion-value').textContent = intValues;
    cy.layout(getLayoutOptions()).run();
});


// ############################################################################
// Tooltip handling
// ############################################################################

cy.on('tap', 'node, edge', function (event) {
    const data = event.target.data();
    let tooltipText = '';

    // Remove any existing tooltips
    document.querySelectorAll('.cy-tooltip').forEach(function (el) {
        el.remove();
    });

    let pos;

    if (event.target.isNode()) {
        const annotations = Array.isArray(data.annotation)
            ? data.annotation.map(function (anno) { return '・ ' + anno; }).join('<br>')
            : '・ ' + data.annotation;

        // Get the MGI link from the map_symbol_to_id
        const url_impc = `https://www.mousephenotype.org/data/genes/${map_symbol_to_id[data.label]}`;

        // Construct the tooltipText with the hyperlink
        tooltipText = `<b>Phenotypes of <a href="${url_impc}" target="_blank">${data.label} KO mice</a></b><br>` + annotations;

        // Get position of the tapped node
        pos = event.target.renderedPosition();

    } else if (event.target.isEdge()) {
        const sourceNode = cy.getElementById(data.source).data('label');
        const targetNode = cy.getElementById(data.target).data('label');
        const annotations = Array.isArray(data.annotation)
            ? data.annotation.map(function (anno) { return '・ ' + anno; }).join('<br>')
            : '・ ' + data.annotation;

        tooltipText = `<b>Shared phenotypes of ${sourceNode} and ${targetNode} KOs</b><br>` + annotations;

        // Calculate the midpoint of the edge for tooltip positioning
        const sourcePos = cy.getElementById(data.source).renderedPosition();
        const targetPos = cy.getElementById(data.target).renderedPosition();
        pos = {
            x: (sourcePos.x + targetPos.x) / 2,
            y: (sourcePos.y + targetPos.y) / 2
        };
    }

    // Create a tooltip element
    const tooltip = document.createElement('div');
    tooltip.classList.add('cy-tooltip');
    tooltip.innerHTML = tooltipText;
    tooltip.style.position = 'absolute';
    tooltip.style.left = (pos.x + 10) + 'px';  // Position to the right of the element
    tooltip.style.top = (pos.y + 10) + 'px';   // Position slightly below the element
    tooltip.style.padding = '5px';
    tooltip.style.background = 'white';
    tooltip.style.border = '1px solid #ccc';
    tooltip.style.borderRadius = '5px';
    tooltip.style.boxShadow = '0 2px 10px rgba(0,0,0,0.2)';
    tooltip.style.zIndex = '1000';
    tooltip.style.cursor = 'move';  // Show the move cursor
    tooltip.style.userSelect = 'text';  // Allow text selection

    // Append the tooltip to the container
    document.querySelector('.cy').appendChild(tooltip);

    // Handle drag events to move the tooltip
    let isDragging = false;
    let offset = { x: 0, y: 0 };

    tooltip.addEventListener('mousedown', function (e) {
        e.stopPropagation(); // Prevent Cytoscape from receiving this event
        isDragging = true;
        const rect = tooltip.getBoundingClientRect();
        offset.x = e.clientX - rect.left;
        offset.y = e.clientY - rect.top;
        tooltip.style.cursor = 'grabbing';
    });

    document.addEventListener('mousemove', function (e) {
        if (isDragging) {
            const containerRect = document.querySelector('.cy').getBoundingClientRect();
            // Adjust the tooltip's position, keeping the offset constant
            tooltip.style.left = (e.clientX - offset.x - containerRect.left) + 'px';
            tooltip.style.top = (e.clientY - offset.y - containerRect.top) + 'px';
        }
    });

    document.addEventListener('mouseup', function () {
        isDragging = false;
        tooltip.style.cursor = 'move';
    });
});


// Hide tooltip when tapping on background
cy.on('tap', function (event) {
    // If the clicked element is not a node or edge, remove the tooltip
    if (event.target === cy) {
        document.querySelectorAll('.cy-tooltip').forEach(function (el) {
            el.remove();
        });
    }
});


// ############################################################################
// Exporter
// ############################################################################

// --------------------------------------------------------
// PNG Exporter
// --------------------------------------------------------

document.getElementById('export-png').addEventListener('click', function () {
    const pngContent = cy.png({
        scale: 6.25,   // Scale to achieve 600 DPI
        full: true     // Set to true to include the entire graph, even the offscreen parts
    });

    const a = document.createElement('a');
    a.href = pngContent;
    a.download = 'TSUMUGI_Rer1.png';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
});


// --------------------------------------------------------
// CSV Exporter
// --------------------------------------------------------

function exportConnectedComponentsToCSV() {
    // calculateConnectedComponentsを利用して連結成分を取得
    const connected_component = calculateConnectedComponents();

    // CSVのヘッダー行
    let csvContent = "cluster,gene,phenotypes\n";

    // クラスター番号を割り当てて、CSVフォーマットに変換
    connected_component.forEach((component, clusterIndex) => {
        const clusterNumber = clusterIndex + 1;

        Object.keys(component).forEach(gene => {
            const phenotypes = component[gene].join(";"); // 表現型をセミコロン区切りで結合

            // CSVの各行を生成
            csvContent += `${clusterNumber},${gene},"${phenotypes}"\n`;
        });
    });

    // CSVファイルを生成しダウンロード
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'TSUMUGI_Rer1.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
}

// レイアウト変更後やフィルタリング後にCSVエクスポートのボタンを押したときに実行
document.getElementById('export-csv').addEventListener('click', function () {
    exportConnectedComponentsToCSV();
});
