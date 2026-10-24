import { Fragment, useEffect, useMemo, useState } from 'react';
import Papa from 'papaparse';
import { MapContainer, TileLayer, Polygon, CircleMarker, Tooltip as LeafletTooltip, useMap } from 'react-leaflet';
import { BarChart, Bar, CartesianGrid, Cell, LabelList, ResponsiveContainer, Tooltip as RechartsTooltip, XAxis, YAxis } from 'recharts';
import { AlertTriangle, Building2, Download, Filter, GraduationCap, MapPinned, Search, School, Users } from 'lucide-react';

const LEVEL_META = [
  { key: 'ed-temprana', field: 'N. ED. TERMPRANA', label: 'Educación temprana' },
  { key: 'inicial', field: 'N.INICIAL', label: 'Nivel inicial' },
  { key: 'primario', field: 'N. PRIMARIO', label: 'Primario' },
  { key: 'secundario', field: 'N. SECUNDARIO', label: 'Secundario' },
  { key: 'superior', field: 'N. SUPERIOR', label: 'Superior' },
];

const MODALITY_META = [
  { key: 'comun', field: 'M. COMUN', label: 'Común' },
  { key: 'especial', field: 'M. ESPECIAL', label: 'Especial' },
  { key: 'rural', field: 'M. RURAL', label: 'Rural' },
  { key: 'tecnica', field: 'M. TECNICA', label: 'Técnica' },
  { key: 'artistica', field: 'M. ARTISTICA', label: 'Artística' },
  { key: 'bilingue', field: 'M. BILINGÜE', label: 'Bilingüe' },
  { key: 'contexto-encierro', field: 'M. CONTEXTO DE ENCIERRO', label: 'Contexto de encierro' },
  { key: 'epja', field: 'M. EPJA', label: 'EPJA' },
];

const palette = ['#7ec8ff', '#58b3f1', '#95c8ff', '#3f8ad6', '#b9ddff', '#89d2ff', '#6caecf', '#dbeeff'];
const chartTooltipContentStyle = {
  backgroundColor: '#2a3441',
  border: '1px solid #05090f',
  borderRadius: '10px',
  boxShadow: '0 8px 20px rgba(0, 0, 0, 0.28)',
  padding: '8px 10px',
};
const chartTooltipTextStyle = {
  color: '#f5fbff',
  textShadow: '-1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000',
};

const normalizeText = (value) => String(value ?? '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[°º]/g, ' ')
  .replace(/[^\p{L}\p{N}\s]/gu, ' ')
  .replace(/\s+/g, ' ')
  .trim()
  .toLowerCase();

const normalizeBarrioName = (value) => normalizeText(value)
  .replace(/^(?:barrio|b)\s+/g, '')
  .replace(/^\s+/, '')
  .replace(/\s+/g, ' ')
  .trim();

const wrapNeighborhoodLabel = (value, maxLength = 27) => {
  const words = String(value ?? '').split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';

  words.forEach((word) => {
    if (word.length > maxLength) {
      if (line) lines.push(line);
      line = '';
      for (let index = 0; index < word.length; index += maxLength) {
        lines.push(word.slice(index, index + maxLength));
      }
      return;
    }

    const candidate = line ? `${line} ${word}` : word;
    if (candidate.length > maxLength && line) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  });

  if (line) lines.push(line);
  return lines.length ? lines : [''];
};

const NeighborhoodAxisTick = ({ x, y, payload }) => {
  const lines = wrapNeighborhoodLabel(payload.value);

  return (
    <g transform={`translate(${x},${y})`}>
      <title>{payload.value}</title>
      <text textAnchor="end" fill="#cfe8ff" fontSize={12}>
        {lines.map((line, index) => (
          <tspan key={`${payload.value}-${index}`} x={-8} dy={index === 0 ? `${(1 - lines.length) * 0.55}em` : '1.1em'}>
            {line}
          </tspan>
        ))}
      </text>
    </g>
  );
};

const parseNumeric = (value) => {
  const cleaned = String(value ?? '').replace(',', '.').trim();
  const number = Number(cleaned);
  return Number.isFinite(number) ? number : null;
};

const formatPercent = (value) => `${value.toFixed(1)}%`;

const getGeoFeatureName = (feature) => {
  const props = feature?.properties ?? {};
  return props.NAM || props.name || props.NOMBRE || props.BARRIO || props.FNA || 'Sin nombre';
};

const getFeaturePolygons = (feature) => {
  const geometry = feature?.geometry;
  const coordinates = geometry?.coordinates;

  if (!Array.isArray(coordinates) || coordinates.length === 0) {
    return [];
  }

  if (geometry.type === 'MultiPolygon') {
    return coordinates.filter((polygon) => Array.isArray(polygon) && polygon.length > 0);
  }

  if (geometry.type === 'Polygon') {
    return [coordinates];
  }

  if (Array.isArray(coordinates[0])) {
    return [coordinates[0]];
  }

  return [];
};

function MapSizeInvalidator() {
  const map = useMap();

  useEffect(() => {
    const container = map.getContainer();
    let frameId;
    const resizeObserver = new ResizeObserver(() => {
      cancelAnimationFrame(frameId);
      frameId = requestAnimationFrame(() => map.invalidateSize({ pan: false }));
    });

    resizeObserver.observe(container);
    map.invalidateSize({ pan: false });

    return () => {
      resizeObserver.disconnect();
      cancelAnimationFrame(frameId);
    };
  }, [map]);

  return null;
}

const buildGeoLookup = (features) => {
  const lookup = new Map();
  features.forEach((feature) => {
    const name = getGeoFeatureName(feature);
    if (!name || name === 'Sin nombre') return;
    lookup.set(normalizeBarrioName(name), name);
  });
  return lookup;
};

const combineValues = (values) => (Array.isArray(values) ? values.filter(Boolean).join(', ') : 'No disponible') || 'No disponible';

const asTitleCase = (value) => String(value ?? '')
  .toLowerCase()
  .split(' ')
  .filter(Boolean)
  .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
  .join(' ');

function DataTable({ rows, columns, pageSize = 10, emptyMessage = 'No hay resultados.', caption }) {
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(pageSize);

  useEffect(() => {
    setPage(1);
  }, [rows.length, size]);

  const totalPages = Math.max(1, Math.ceil(rows.length / size));
  const safePage = Math.min(page, totalPages);
  const paginatedRows = rows.slice((safePage - 1) * size, safePage * size);

  return (
    <div className="table-card">
      {caption ? <div className="table-caption">{caption}</div> : null}
      <div className="table-toolbar">
        <span>{rows.length} resultados • página {safePage} de {totalPages}</span>
        <div className="table-controls">
          <label>
            <span>Filas</span>
            <select value={size} onChange={(event) => setSize(Number(event.target.value))}>
              <option value={10}>10</option>
              <option value={25}>25</option>
              <option value={50}>50</option>
            </select>
          </label>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="empty-state">{emptyMessage}</div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                {columns.map((column) => <th key={column.key}>{column.label}</th>)}
              </tr>
            </thead>
            <tbody>
              {paginatedRows.map((row, rowIndex) => (
                <tr key={row.id ?? `${rowIndex}-${row.cue ?? row.fna ?? row.name ?? ''}`}>
                  {columns.map((column) => (
                    <td key={`${rowIndex}-${column.key}`}>{column.render ? column.render(row) : row[column.key]}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {rows.length > 0 ? (
        <div className="pagination">
          <button type="button" onClick={() => setPage((value) => Math.max(1, value - 1))} disabled={safePage <= 1}>Anterior</button>
          <button type="button" onClick={() => setPage((value) => Math.min(totalPages, value + 1))} disabled={safePage >= totalPages}>Siguiente</button>
        </div>
      ) : null}
    </div>
  );
}

function App() {
  const [rows, setRows] = useState([]);
  const [features, setFeatures] = useState([]);
  const [rawCsvText, setRawCsvText] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [selectedBarrios, setSelectedBarrios] = useState([]);
  const [selectedLevels, setSelectedLevels] = useState([]);
  const [selectedModalities, setSelectedModalities] = useState([]);
  const [barriosViewMode, setBarriosViewMode] = useState('all');
  const [barriosSortMode, setBarriosSortMode] = useState('max');
  const [mapLayers, setMapLayers] = useState({ barrios: true, establishments: true, levels: false, modalities: false });
  const [compareMetric, setCompareMetric] = useState('level');
  const [selectedComparisonBarrios, setSelectedComparisonBarrios] = useState([]);
  const [comparisonSearch, setComparisonSearch] = useState('');
  const [sourceSearch, setSourceSearch] = useState('');

  useEffect(() => {
    const loadData = async () => {
      try {
        setLoading(true);
        const [csvResponse, geoResponse] = await Promise.all([
          fetch('/data/ESCUELAS_DEFINITIVA.csv'),
          fetch('/data/BarriosCorrientes.geojson'),
        ]);

        if (!csvResponse.ok || !geoResponse.ok) {
          throw new Error('No se pudo cargar la base de datos o el GeoJSON.');
        }

        const csvText = await csvResponse.text();
        const geoJson = await geoResponse.json();
        const parsed = Papa.parse(csvText, {
          header: true,
          skipEmptyLines: true,
          transformHeader: (header) => header?.trim() ?? '',
        });

        const geoLookup = buildGeoLookup(geoJson.features || []);
        const processed = (parsed.data || []).map((row, index) => {
          const rawBarrio = row.BARRIOS_CORREGIDO || row.BARRIO || row.BARRIOS || row['BARRIO'] || '';
          const safeBarrio = String(rawBarrio ?? '').trim();
          const normalizedBarrio = normalizeBarrioName(safeBarrio);
          const geoMatchedName = geoLookup.get(normalizedBarrio) || null;
          const latitude = parseNumeric(row.LATITUD);
          const longitude = parseNumeric(row.LONGITUD);
          const validCoordinates = latitude !== null && longitude !== null
            && latitude >= -90 && latitude <= 90
            && longitude >= -180 && longitude <= 180;
          const levelValues = LEVEL_META.filter((entry) => Number(row[entry.field]) === 1).map((entry) => entry.label);
          const modalityValues = MODALITY_META.filter((entry) => Number(row[entry.field]) === 1).map((entry) => entry.label);

          return {
            id: row.gid || index + 1,
            gid: row.gid || index + 1,
            longitud: longitude,
            latitud: latitude,
            hasCoordinates: validCoordinates,
            fna: row.fna || row.FNA || 'No disponible',
            cue: row.cue || row.CUE || 'No disponible',
            mde: row.mde || row.MDE || 'No disponible',
            barrio: safeBarrio,
            barrioGeo: geoMatchedName || (normalizedBarrio ? asTitleCase(safeBarrio) : ''),
            barrioNormalized: normalizedBarrio,
            barrioMatched: Boolean(geoMatchedName),
            levels: levelValues,
            modalities: modalityValues,
            raw: row,
          };
        });

        setRows(processed);
        setFeatures(geoJson.features || []);
        setRawCsvText(csvText);
        setError('');
        setLoading(false);
      } catch (loadError) {
        setError(loadError.message || 'Error al cargar los datos.');
        setLoading(false);
      }
    };

    loadData();
  }, []);

  const uniqueNeighborhoods = useMemo(
    () => [...new Set(rows.map((row) => row.barrioGeo).filter(Boolean))].sort(),
    [rows],
  );

  const filteredRows = useMemo(() => {
    const normalizedQuery = normalizeText(query);
    return rows.filter((row) => {
      const barrioMatch = selectedBarrios.length === 0 || selectedBarrios.includes(row.barrioGeo || row.barrio);
      const levelMatch = selectedLevels.length === 0 || selectedLevels.some((level) => row.levels.includes(level));
      const modalityMatch = selectedModalities.length === 0 || selectedModalities.some((modality) => row.modalities.includes(modality));
      const textMatch = !normalizedQuery || [row.fna, String(row.gid ?? ''), row.cue].some((value) => normalizeText(value).includes(normalizedQuery));
      return barrioMatch && levelMatch && modalityMatch && textMatch;
    });
  }, [rows, query, selectedBarrios, selectedLevels, selectedModalities]);

  const summaryCards = useMemo(() => {
    const validCoords = rows.filter((row) => row.hasCoordinates).length;
    const withBarrio = rows.filter((row) => row.barrioMatched).length;
    const withLevels = rows.filter((row) => row.levels.length > 0).length;
    const withModalities = rows.filter((row) => row.modalities.length > 0).length;

    return [
      { label: 'Registros totales', value: rows.length, icon: Building2, note: 'Fuente principal del proyecto' },
      { label: 'Con coordenadas', value: validCoords, icon: MapPinned, note: `${formatPercent((validCoords / Math.max(rows.length, 1)) * 100)} del total` },
      { label: 'Con barrio asociado', value: withBarrio, icon: School, note: `${formatPercent((withBarrio / Math.max(rows.length, 1)) * 100)} del total` },
      { label: 'Barrios representados', value: uniqueNeighborhoods.length, icon: Users, note: 'Barrios con registros asociados' },
      { label: 'Con nivel registrado', value: withLevels, icon: GraduationCap, note: 'Al menos un nivel identificado' },
      { label: 'Con modalidad registrada', value: withModalities, icon: Filter, note: 'Al menos una modalidad identificada' },
    ];
  }, [rows, uniqueNeighborhoods]);

  const levelCounts = useMemo(() => {
    const counts = Object.fromEntries(LEVEL_META.map((entry) => [entry.label, 0]));
    filteredRows.forEach((row) => {
      row.levels.forEach((level) => { counts[level] = (counts[level] || 0) + 1; });
    });
    return LEVEL_META.map((entry) => ({ name: entry.label, value: counts[entry.label] || 0 }));
  }, [filteredRows]);

  const modalityCounts = useMemo(() => {
    const counts = Object.fromEntries(MODALITY_META.map((entry) => [entry.label, 0]));
    filteredRows.forEach((row) => {
      row.modalities.forEach((modality) => { counts[modality] = (counts[modality] || 0) + 1; });
    });
    return MODALITY_META.map((entry) => ({ name: entry.label, value: counts[entry.label] || 0 }));
  }, [filteredRows]);

  const barrioCounts = useMemo(() => {
    const namesByNormalized = new Map();
    features.forEach((feature) => {
      const name = getGeoFeatureName(feature);
      if (!name || name === 'Sin nombre') return;
      const normalizedName = normalizeBarrioName(name);
      if (normalizedName && !namesByNormalized.has(normalizedName)) {
        namesByNormalized.set(normalizedName, name);
      }
    });

    const counts = new Map([...namesByNormalized].map(([normalizedName, label]) => [normalizedName, { label, count: 0 }]));
    filteredRows.forEach((row) => {
      if (!row.barrioMatched) return;
      const normalizedName = normalizeBarrioName(row.barrioGeo);
      const count = counts.get(normalizedName);
      if (count) count.count += 1;
    });
    return [...counts.values()];
  }, [features, filteredRows]);

  const filteredBarriosForTop = useMemo(() => {
    const source = [...barrioCounts].sort((a, b) => {
      const countOrder = barriosSortMode === 'max' ? b.count - a.count : a.count - b.count;
      return countOrder || a.label.localeCompare(b.label, 'es', { sensitivity: 'base' });
    });
    if (barriosViewMode === 'top5') return source.slice(0, 5);
    if (barriosViewMode === 'top10') return source.slice(0, 10);
    return source;
  }, [barriosSortMode, barrioCounts, barriosViewMode]);

  const neighborhoodRowHeight = useMemo(
    () => Math.max(32, ...filteredBarriosForTop.map((row) => 22 + wrapNeighborhoodLabel(row.label).length * 13)),
    [filteredBarriosForTop],
  );

  const neighborhoodOptions = uniqueNeighborhoods.length ? uniqueNeighborhoods : ['Sin barrio identificado'];
  const mapLegendItems = mapLayers.levels
    ? [
      ...LEVEL_META.map((entry, index) => ({ label: entry.label, color: palette[index % palette.length] })),
      ...(filteredRows.some((row) => row.levels.length === 0) ? [{ label: 'Sin nivel identificado', color: '#9aa7b5' }] : []),
    ]
    : mapLayers.modalities
      ? [
        ...MODALITY_META.map((entry, index) => ({ label: entry.label, color: palette[(index + 2) % palette.length] })),
        ...(filteredRows.some((row) => row.modalities.length === 0) ? [{ label: 'Sin modalidad identificada', color: '#9aa7b5' }] : []),
      ]
      : mapLayers.establishments
        ? [{ label: 'Establecimientos', color: '#4bb7ff' }]
        : [];

  const barrioComparisonData = useMemo(() => {
    const categories = compareMetric === 'level' ? LEVEL_META : MODALITY_META;
    const selected = selectedComparisonBarrios.length > 0 ? selectedComparisonBarrios : uniqueNeighborhoods.slice(0, 3);
    const data = categories.map((category) => {
      const item = { category: category.label };
      selected.forEach((barri) => {
        const count = rows.filter((row) => (row.barrioGeo || row.barrio) === barri).filter((row) => {
          const list = compareMetric === 'level' ? row.levels : row.modalities;
          return list.includes(category.label);
        }).length;
        item[barri] = count;
      });
      return item;
    });
    return { data };
  }, [compareMetric, rows, selectedComparisonBarrios, uniqueNeighborhoods]);

  const comparisonTableRows = useMemo(() => {
    const categories = compareMetric === 'level' ? LEVEL_META : MODALITY_META;
    return categories.map((category) => {
      const row = { category: category.label };
      selectedComparisonBarrios.forEach((barri) => {
        row[barri] = rows.filter((entry) => (entry.barrioGeo || entry.barrio) === barri).filter((entry) => {
          const values = compareMetric === 'level' ? entry.levels : entry.modalities;
          return values.includes(category.label);
        }).length;
      });
      return row;
    });
  }, [compareMetric, rows, selectedComparisonBarrios]);

  const allSourceRows = useMemo(() => {
    const queryText = normalizeText(sourceSearch);
    return rows.filter((row) =>
      !queryText || [row.fna, row.cue, String(row.gid ?? ''), row.barrioGeo || row.barrio].some((value) => normalizeText(value).includes(queryText)),
    );
  }, [rows, sourceSearch]);

  const handleToggleComparison = (barri) => {
    setSelectedComparisonBarrios((current) => {
      if (current.includes(barri)) return current.filter((value) => value !== barri);
      return [...current, barri];
    });
  };

  const explorerColumns = [
    { key: 'id', label: 'ID', render: (record) => record.gid ?? record.id },
    { key: 'cue', label: 'CUE', render: (record) => record.cue || 'No disponible' },
    { key: 'fna', label: 'Nombre completo', render: (record) => record.fna || 'No disponible' },
    { key: 'barrio', label: 'Barrio', render: (record) => record.barrioGeo || record.barrio || 'Sin barrio asociado' },
    { key: 'levels', label: 'Nivel educativo', render: (record) => combineValues(record.levels) },
    { key: 'modalities', label: 'Modalidad', render: (record) => combineValues(record.modalities) },
  ];

  const sourceColumns = [
    { key: 'id', label: 'ID', render: (record) => record.gid ?? record.id },
    { key: 'cue', label: 'CUE', render: (record) => record.cue || 'No disponible' },
    { key: 'fna', label: 'Nombre', render: (record) => record.fna || 'No disponible' },
    { key: 'barrio', label: 'Barrio', render: (record) => record.barrioGeo || record.barrio || 'Sin barrio asociado' },
    { key: 'levels', label: 'Nivel educativo', render: (record) => combineValues(record.levels) },
    { key: 'modalities', label: 'Modalidad', render: (record) => combineValues(record.modalities) },
  ];

  if (loading) return <div className="loader">Cargando datos del CSV y del GeoJSON...</div>;
  if (error) return <div className="error-banner">{error}</div>;

  return (
    <div className="dashboard-shell">
      <header className="top-header">
        <div>
          <p className="eyebrow">Proyecto académico</p>
          <h1>Educación en el territorio</h1>
          <p className="subtitle">Análisis territorial de establecimientos educativos y Centros de Desarrollo Infantil de Corrientes.</p>
        </div>
      </header>

      <main className="content-grid">
        <section className="summary-grid">
          {summaryCards.map(({ label, value, icon: Icon, note }) => (
            <article key={label} className="summary-card">
              <div className="summary-icon"><Icon size={18} /></div>
              <div>
                <div className="summary-label">{label}</div>
                <div className="summary-value">{value}</div>
                <div className="summary-note">{note}</div>
              </div>
            </article>
          ))}
        </section>

        <section className="panel explorer-panel">
          <div className="section-heading">
            <div>
              <p className="section-kicker">Explorador</p>
              <h2>Consulta de establecimientos</h2>
            </div>
            <button
              className="secondary-button"
              type="button"
              onClick={() => { setQuery(''); setSelectedBarrios([]); setSelectedLevels([]); setSelectedModalities([]); }}
            >
              Limpiar filtros
            </button>
          </div>

          <div className="filter-grid">
            <label className="filter-field">
              <span>Barrio</span>
              <select multiple value={selectedBarrios} onChange={(event) => setSelectedBarrios([...event.target.selectedOptions].map((option) => option.value))}>
                {neighborhoodOptions.map((neighborhood) => <option key={neighborhood} value={neighborhood}>{neighborhood}</option>)}
              </select>
            </label>

            <label className="filter-field">
              <span>Nivel educativo</span>
              <select multiple value={selectedLevels} onChange={(event) => setSelectedLevels([...event.target.selectedOptions].map((option) => option.value))}>
                {LEVEL_META.map((level) => <option key={level.label} value={level.label}>{level.label}</option>)}
              </select>
            </label>

            <label className="filter-field">
              <span>Modalidad</span>
              <select multiple value={selectedModalities} onChange={(event) => setSelectedModalities([...event.target.selectedOptions].map((option) => option.value))}>
                {MODALITY_META.map((modality) => <option key={modality.label} value={modality.label}>{modality.label}</option>)}
              </select>
            </label>

            <label className="filter-field search-field">
              <span>Buscar</span>
              <div className="input-with-icon">
                <Search size={16} />
                <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Nombre, ID o CUE" />
              </div>
            </label>
          </div>
        </section>

        <section className="panel table-section">
          <DataTable rows={filteredRows} columns={explorerColumns} pageSize={10} emptyMessage="No se encontraron coincidencias para la combinación de filtros seleccionada." caption="Resultados del explorador" />
        </section>

        <section className="panel map-panel">
          <div className="section-heading">
            <div>
              <p className="section-kicker">Mapa</p>
              <h2>Distribución territorial</h2>
            </div>
          </div>

          <div className="layer-controls">
            <label><input type="checkbox" checked={mapLayers.barrios} onChange={() => setMapLayers((current) => ({ ...current, barrios: !current.barrios }))} /> Barrios</label>
            <label><input type="checkbox" checked={mapLayers.establishments} onChange={() => setMapLayers((current) => ({ ...current, establishments: !current.establishments }))} /> Establecimientos</label>
            <label><input type="checkbox" checked={mapLayers.levels} onChange={() => setMapLayers((current) => ({ ...current, levels: !current.levels }))} /> Niveles educativos</label>
            <label><input type="checkbox" checked={mapLayers.modalities} onChange={() => setMapLayers((current) => ({ ...current, modalities: !current.modalities }))} /> Modalidades</label>
          </div>

          <div className="map-wrap">
            <MapContainer center={[-27.4692, -58.8306]} zoom={12} scrollWheelZoom zoomControl className="leaflet-map">
              <MapSizeInvalidator />
              <TileLayer attribution="&copy; OpenStreetMap contributors" url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />

              {mapLayers.barrios && features.map((feature, index) => {
                const polygons = getFeaturePolygons(feature);
                const name = getGeoFeatureName(feature);
                if (polygons.length === 0) return null;
                return (
                  <Fragment key={`${name}-${index}`}>
                    {polygons.map((polygon, polygonIndex) => (
                      <Polygon key={`${name}-${index}-${polygonIndex}`} positions={polygon.map((ring) => ring.map(([lng, lat]) => [lat, lng]))} pathOptions={{ color: '#7ec8ff', weight: 1, fillColor: '#1b2d48', fillOpacity: 0.18 }}>
                        <LeafletTooltip direction="top" offset={[0, -6]} opacity={1}>{name}</LeafletTooltip>
                      </Polygon>
                    ))}
                  </Fragment>
                );
              })}

              {(mapLayers.establishments || mapLayers.levels || mapLayers.modalities) && filteredRows.filter((row) => row.hasCoordinates).map((row, index) => {
                const latitude = Number(row.latitud);
                const longitude = Number(row.longitud);
                const levelIndex = LEVEL_META.findIndex((entry) => row.levels.includes(entry.label));
                const modalityIndex = MODALITY_META.findIndex((entry) => row.modalities.includes(entry.label));
                const markerColor = mapLayers.levels
                  ? (levelIndex >= 0 ? palette[levelIndex % palette.length] : '#9aa7b5')
                  : mapLayers.modalities
                    ? (modalityIndex >= 0 ? palette[(modalityIndex + 2) % palette.length] : '#9aa7b5')
                    : '#4bb7ff';

                return (
                  <CircleMarker key={`${row.gid ?? index}-${index}`} center={[latitude, longitude]} radius={5} pathOptions={{ color: '#dff6ff', fillColor: markerColor, fillOpacity: 0.9, weight: 1 }}>
                    <LeafletTooltip direction="top" offset={[0, -8]} opacity={1}>
                      <div className="map-tooltip">
                        <strong>{row.fna || 'No disponible'}</strong>
                        <span>ID: {row.gid ?? 'No disponible'}</span>
                        <span>CUE: {row.cue || 'No disponible'}</span>
                        <span>Niveles: {combineValues(row.levels)}</span>
                        <span>Modalidades: {combineValues(row.modalities)}</span>
                      </div>
                    </LeafletTooltip>
                  </CircleMarker>
                );
              })}
            </MapContainer>
            {(mapLayers.barrios || mapLegendItems.length > 0) && (
              <aside className="map-legend" aria-label="Leyenda del mapa">
                {mapLayers.barrios && (
                  <div className="map-legend-item">
                    <span className="map-legend-boundary" />
                    <span>Barrios</span>
                  </div>
                )}
                {mapLegendItems.map(({ label, color }) => (
                  <div className="map-legend-item" key={label}>
                    <span className="map-legend-marker" style={{ backgroundColor: color }} />
                    <span>{label}</span>
                  </div>
                ))}
              </aside>
            )}
          </div>
        </section>

        <section className="stats-grid">
          <article className="panel chart-panel">
            <div className="section-heading chart-title">
              <div>
                <p className="section-kicker">Oferta por nivel</p>
                <h3>Registros por nivel educativo</h3>
              </div>
            </div>
            <div className="chart-stat">{filteredRows.filter((row) => row.levels.length > 0).length} registros con nivel</div>
            <div className="chart-box">
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={levelCounts} layout="vertical" margin={{ top: 8, right: 24, left: 8, bottom: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#2b3d5f" />
                  <XAxis type="number" stroke="#cfe8ff" />
                  <YAxis type="category" dataKey="name" width={120} stroke="#cfe8ff" />
                  <RechartsTooltip contentStyle={chartTooltipContentStyle} itemStyle={chartTooltipTextStyle} labelStyle={{ ...chartTooltipTextStyle, fontWeight: 700 }} wrapperStyle={{ zIndex: 1200 }} />
                  <Bar dataKey="value" radius={[0, 10, 10, 0]}>
                    {levelCounts.map((entry, index) => <Cell key={`${entry.name}-${index}`} fill={palette[index % palette.length]} />)}
                    <LabelList dataKey="value" position="right" fill="#cfe8ff" fontSize={12} />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </article>

          <article className="panel chart-panel">
            <div className="section-heading chart-title">
              <div>
                <p className="section-kicker">Oferta por modalidad</p>
                <h3>Registros por modalidad</h3>
              </div>
            </div>
            <div className="chart-stat">{filteredRows.filter((row) => row.modalities.length > 0).length} registros con modalidad</div>
            <div className="chart-box">
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={modalityCounts} layout="vertical" margin={{ top: 8, right: 24, left: 8, bottom: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#2b3d5f" />
                  <XAxis type="number" stroke="#cfe8ff" />
                  <YAxis type="category" dataKey="name" width={130} stroke="#cfe8ff" />
                  <RechartsTooltip contentStyle={chartTooltipContentStyle} itemStyle={chartTooltipTextStyle} labelStyle={{ ...chartTooltipTextStyle, fontWeight: 700 }} wrapperStyle={{ zIndex: 1200 }} />
                  <Bar dataKey="value" radius={[0, 10, 10, 0]}>
                    {modalityCounts.map((entry, index) => <Cell key={`${entry.name}-${index}`} fill={palette[(index + 2) % palette.length]} />)}
                    <LabelList dataKey="value" position="right" fill="#cfe8ff" fontSize={12} />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </article>
        </section>

        <section className="panel chart-panel full-width">
          <div className="section-heading chart-title">
            <div>
              <p className="section-kicker">Concentración</p>
              <h3>Registros por barrio</h3>
            </div>
            <div className="inline-actions">
              <select value={barriosSortMode} onChange={(event) => setBarriosSortMode(event.target.value)}>
                <option value="max">Mayor concentración</option>
                <option value="min">Menor concentración</option>
              </select>
              <select value={barriosViewMode} onChange={(event) => setBarriosViewMode(event.target.value)}>
                <option value="all">Todos</option>
                <option value="top5">Top 5</option>
                <option value="top10">Top 10</option>
              </select>
            </div>
          </div>

          <div className="chart-box large-box neighborhood-chart">
            <ResponsiveContainer width="100%" height={Math.max(320, filteredBarriosForTop.length * neighborhoodRowHeight + 24)}>
              <BarChart data={filteredBarriosForTop} layout="vertical" margin={{ top: 12, right: 34, left: 12, bottom: 12 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#2b3d5f" />
                <XAxis type="number" stroke="#cfe8ff" />
                <YAxis type="category" dataKey="label" width={230} stroke="#cfe8ff" interval={0} minTickGap={0} tickMargin={8} tick={<NeighborhoodAxisTick />} />
                <RechartsTooltip contentStyle={chartTooltipContentStyle} itemStyle={chartTooltipTextStyle} labelStyle={{ ...chartTooltipTextStyle, fontWeight: 700 }} wrapperStyle={{ zIndex: 1200 }} />
                <Bar dataKey="count" radius={[0, 8, 8, 0]} fill="#77c3ff">
                  <LabelList dataKey="count" position="right" fill="#cfe8ff" fontSize={12} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>

        <section className="panel comparison-panel full-width">
          <div className="section-heading">
            <div>
              <p className="section-kicker">Comparación</p>
              <h2>Comparación entre barrios</h2>
            </div>
            <div className="inline-actions">
              <select value={compareMetric} onChange={(event) => setCompareMetric(event.target.value)}>
                <option value="level">Por nivel educativo</option>
                <option value="modality">Por modalidad</option>
              </select>
            </div>
          </div>

          <div className="comparison-controls">
            <div className="filter-field search-field compact">
              <span>Buscar barrio</span>
              <input value={comparisonSearch} onChange={(event) => setComparisonSearch(event.target.value)} placeholder="Filtrar barrios" />
            </div>
            <div className="comparison-list">
              {neighborhoodOptions.filter((item) => normalizeText(item).includes(normalizeText(comparisonSearch))).map((neighborhood) => (
                <label key={neighborhood} className="check-option">
                  <input type="checkbox" checked={selectedComparisonBarrios.includes(neighborhood)} onChange={() => handleToggleComparison(neighborhood)} />
                  <span>{neighborhood}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="chart-box large-box">
            <ResponsiveContainer width="100%" height={360}>
              <BarChart data={barrioComparisonData.data} margin={{ top: 8, right: 16, left: 0, bottom: 18 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#2b3d5f" />
                <XAxis dataKey="category" stroke="#cfe8ff" />
                <YAxis stroke="#cfe8ff" />
                <RechartsTooltip contentStyle={chartTooltipContentStyle} itemStyle={chartTooltipTextStyle} labelStyle={{ ...chartTooltipTextStyle, fontWeight: 700 }} wrapperStyle={{ zIndex: 1200 }} />
                {(selectedComparisonBarrios.length ? selectedComparisonBarrios : uniqueNeighborhoods.slice(0, 3)).map((barri, index) => (
                  <Bar key={barri} dataKey={barri} fill={palette[index % palette.length]} radius={[8, 8, 0, 0]} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>

          <DataTable
            rows={comparisonTableRows}
            columns={selectedComparisonBarrios.length ? selectedComparisonBarrios.map((barri) => ({ key: barri, label: barri, render: (row) => row[barri] ?? 0 })) : [{ key: 'category', label: 'Categoría', render: (row) => row.category }].concat(uniqueNeighborhoods.slice(0, 3).map((barri) => ({ key: barri, label: barri, render: (row) => row[barri] ?? 0 })))}
            pageSize={10}
            emptyMessage="Selecciona barrios para comparar categorías."
            caption={`${compareMetric === 'level' ? 'Niveles educativos' : 'Modalidades'} por barrio`}
          />
        </section>

        <section className="panel source-panel full-width">
          <div className="section-heading">
            <div>
              <p className="section-kicker">Fuente original</p>
              <h2>Registro completo de la base</h2>
            </div>
            <button
              type="button"
              className="primary-button"
              onClick={() => {
                const blob = new Blob([rawCsvText], { type: 'text/csv;charset=utf-8;' });
                const link = document.createElement('a');
                link.href = URL.createObjectURL(blob);
                link.download = 'ESCUELAS_DEFINITIVA.csv';
                link.click();
                URL.revokeObjectURL(link.href);
              }}
            >
              <Download size={16} /> Exportar CSV original
            </button>
          </div>

          <div className="source-search">
            <div className="input-with-icon">
              <Search size={16} />
              <input value={sourceSearch} onChange={(event) => setSourceSearch(event.target.value)} placeholder="Buscar por nombre, ID o CUE" />
            </div>
          </div>

          <DataTable rows={allSourceRows} columns={sourceColumns} pageSize={10} emptyMessage="No se encontraron registros en la fuente original para esta búsqueda." caption="Base completa" />
        </section>

        <section className="panel methodology-panel full-width">
          <div className="section-heading">
            <div>
              <p className="section-kicker">Metodología</p>
              <h2>Cómo se interpreta esta información</h2>
            </div>
          </div>
          <div className="text-grid">
            <div>
              <p>La fuente principal es <strong>ESCUELAS_DEFINITIVA.csv</strong>. Cada registro representa un establecimiento educativo o un tipo de oferta registrado en la base municipal y contiene coordenadas, nombre, CUE, barrio y categorías de nivel/modalidad.</p>
              <p>Los recuentos por nivel y modalidad se calculan a partir de las columnas reales del CSV. Un mismo establecimiento puede estar asociado a más de un nivel o a más de una modalidad. Por eso, los conteos no son mutuamente excluyentes y no deben interpretarse como cantidad de establecimientos únicos.</p>
            </div>
            <div>
              <p>La asociación de registros con barrios se realiza usando la columna <strong>BARRIOS_CORREGIDO</strong> y el GeoJSON de barrios. Los registros sin barrio identificado se mantienen en la base y se resaltan como “Sin barrio asociado” en la interfaz.</p>
              <p>No se utilizan indicadores basados en población ni datos de <strong>INDEC.csv</strong>, porque el análisis no contempla población ni cobertura educativa estimada. La cantidad de registros por barrio refleja la oferta registrada en la base analizada, no la capacidad, matrícula ni cobertura institucional.</p>
            </div>
          </div>
        </section>

        <section className="panel quality-panel full-width">
          <div className="section-heading">
            <div>
              <p className="section-kicker">Control de calidad</p>
              <h2>Validación de la fuente y la geometría</h2>
            </div>
          </div>

          <div className="quality-grid">
            <div className="quality-item"><div className="quality-label">Registros en el CSV</div><div className="quality-number">{rows.length}</div></div>
            <div className="quality-item"><div className="quality-label">Con coordenadas válidas</div><div className="quality-number">{rows.filter((row) => row.hasCoordinates).length}</div></div>
            <div className="quality-item"><div className="quality-label">Asociados a barrio</div><div className="quality-number">{rows.filter((row) => row.barrioMatched).length}</div></div>
            <div className="quality-item"><div className="quality-label">Barrios presentes en GeoJSON</div><div className="quality-number">{features.length}</div></div>
            <div className="quality-item"><div className="quality-label">Barrios identificados en registros</div><div className="quality-number">{new Set(rows.map((row) => row.barrioGeo || row.barrio).filter(Boolean)).size}</div></div>
            <div className="quality-item"><div className="quality-label">Registros sin barrio identificado</div><div className="quality-number">{rows.filter((row) => !row.barrioMatched).length}</div></div>
          </div>

          <div className="quality-note">
            <AlertTriangle size={16} />
            <span>La validación se realizó sobre los archivos reales del repositorio. Los registros con datos faltantes o sin asociación geográfica se conservan para no perder información, pero se identifican explícitamente en el análisis.</span>
          </div>
        </section>
      </main>

      <footer className="footer">
        <span>Proyecto: Educación en el territorio</span>
        <span>Corrientes • análisis territorial educativo</span>
      </footer>
    </div>
  );
}

export default App;
