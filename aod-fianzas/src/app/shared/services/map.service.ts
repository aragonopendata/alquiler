import { Injectable } from '@angular/core';
import { Map, View } from 'ol';
import { TileWMS } from 'ol/source';
import VectorSource from 'ol/source/Vector';
import { boundingExtent } from 'ol/extent';
import Projection from 'ol/proj/Projection';
import TileLayer from 'ol/layer/Tile';
import { GeoJSON } from 'ol/format';
import VectorLayer from 'ol/layer/Vector';
import { environment } from 'src/environments/environment';
import { IgearService } from './igear.service';
import { TipoBusqueda } from '../models/tipo-busqueda.enum';
import { ObjectId } from '../models/object-id.model';
import { EMPTY, Observable } from 'rxjs';
import { Coordinate } from 'ol/coordinate';
import { map, mergeMap, switchMap } from 'rxjs/operators';
import Style from 'ol/style/Style';
import Stroke from 'ol/style/Stroke';
import { FeatureSelect } from '../models/feature-select.model';

@Injectable({
  providedIn: 'root'
})
export class MapService {

  constructor(private igearService: IgearService) { }

  /**
   * 
   * @ngdoc method
   * @name MapService.initMap
   * @description
   * @param {string=} target 
   * @returns {Map=}
   */
   initMap(target: string): Map {
    const extent = boundingExtent(environment.aragonBoundingBox);
    const projection = new Projection({
      code: environment.epsgCode,
      units: 'm'
    });
    const options = {
      projection: projection,
    };
    const layer = new TileLayer({
      source: new TileWMS({
        url: environment.urlWMSServer,
        params: {
          LAYERS: environment.wmsLayers,
          VERSION: environment.wmsVersion
        },
        projection: projection
      })
    });
    const olMap = new Map({
      target: target,
      view: new View(options),
    });
    olMap.addLayer(layer);
    olMap.getView().fit(extent);
    return olMap;
  }

  /**
   * 
   * @ngdoc method
   * @name MapService.addLayer
   * @description
   * @param {Map=} olMap 
   * @param {string=} ObjectId 
   * @param {string=} typename 
   * @param {string=} capa 
   * @param {number=} distancia 
   */
  addLayer(olMap: Map, ObjectId: string, typename: string, capa: string, distancia: number): void {
    this.igearService.spatialSearchService(ObjectId, typename)
      .pipe(switchMap(response => {
        let cqlFilter = typename === environment.typenameCP ? `objectid=${ObjectId}` : '';
        for (let resultado of response.resultados) {
          if (resultado.distancia === distancia && resultado.capa.includes(capa)) {
            for (let feature of resultado.featureCollection.features) {
              const oid = feature.properties.objectid;
              cqlFilter += cqlFilter !== '' ? ` OR objectid=${oid}` : `objectid=${oid}`;
            }
            break;
          }
        }
        return this.igearService.sitaWMSGetFeature(capa, cqlFilter);
      }))
      .subscribe(response => {
        const extent = boundingExtent(this.getBBox(response.features));
        const geojsonFormat = new GeoJSON();
        const features = geojsonFormat.readFeatures(JSON.stringify(response));
        const vectorLayer = new VectorLayer({
          source: new VectorSource({
            format: geojsonFormat,
            features: features,
          }),
          style: new Style({
            stroke: new Stroke({
              color: 'blue',
              width: 3
            })
          })
        });
        olMap.addLayer(vectorLayer);
        olMap.on('click', (evt) => {
          let pixel = olMap.getEventPixel(evt.originalEvent);
          olMap.forEachFeatureAtPixel(pixel, (feature, resolution) => {
            this.onFeatureSelectFuncion(evt, feature);
          })
        })
        olMap.getView().fit(extent);
      });
  }

  addListener(olMap: Map, callback: (featureSelect: FeatureSelect) => void) {
    olMap.on('click', (evt) => {
      let pixel = olMap.getEventPixel(evt.originalEvent);
      olMap.forEachFeatureAtPixel(pixel, (feature, resolution) => {
        const featureSelect = {
          evt: evt,
          feature: feature
        }
        callback(featureSelect);
      })
    })
  }

  /**
   * 
   * @ngdoc method
   * @name MapService.getObjectId
   * @description
   * @param {string=} searchString 
   * @returns {Observable<ObjectId>=}
   */
  getObjectId(searchString: string): Observable<ObjectId> {
    const fields: string[] = searchString.toLowerCase().split(',');
    const tipoBusqueda = this.getTipoBusqueda(searchString);
    const texto: string = fields[0];
    const muni: string = fields[1];
    let service: Observable<ObjectId> = EMPTY;
    if (tipoBusqueda === TipoBusqueda.CP) {
      service = this.getObjectIdByCP(texto, environment.typedSearchCP);
    } else if (tipoBusqueda === TipoBusqueda.CALLE) {
      service = this.getObjectIdByDireccion(texto, environment.typedSearchDIRECCION, muni);
    } else if (tipoBusqueda === TipoBusqueda.LOCALIDAD) {
      service = this.getObjectIdByLocalidad(texto, environment.typedSearchLOCALIDAD);
    }
    return service;
  }

  /**
   * 
   * @param texto 
   * @param type 
   * @returns 
   */
  getObjectIdByCP(texto: string, type: string): Observable<ObjectId> {
    return this.igearService.typedSearchService(texto, type)
      .pipe(map((res:XMLDocument) => {
        const objectId: ObjectId = {
          objectId: res.getElementsByTagName('List')[0].textContent?.split('#')[3],
          typename: environment.typenameCP
        }
        return objectId;
      }));
  }

  /**
   * 
   * @param texto 
   * @param type 
   * @param muni 
   * @returns 
   */
  getObjectIdByDireccion(texto: string, type: string, muni: string): Observable<ObjectId> {
    return this.igearService.typedSearchService(texto, type, muni)
      .pipe(mergeMap((res:XMLDocument) => {
          const c_mun_via = res.getElementsByTagName('List')[0].textContent?.split('#')[3];
          const cqlFilter = `c_mun_via='${c_mun_via}'`;
          return this.igearService.visor2Dservice(type, cqlFilter)
      }),
      map((res: any) => {
        const objectId: ObjectId = {
          objectId: res.features[0].properties.objectid,
          typename: environment.typenameDIRECCION
        }
        return objectId;
      }));
  }

  /**
   * 
   * @param texto 
   * @param type 
   * @param muni 
   * @returns 
   */
  getObjectIdByLocalidad(texto: string, type: string): Observable<ObjectId> {
    return this.igearService.typedSearchService(texto, type)
      .pipe(map((res:XMLDocument) => {
        const objectId: ObjectId = {
          objectId: res.getElementsByTagName('List')[0].textContent?.split('#')[3],
          typename: environment.typenameLOCALIDAD
        }
        return objectId;
      }));
  }

  /**
   * 
   * @ngdoc method
   * @name MapService.getTipoBusqueda
   * @description
   * @param {string=} searchString 
   * @returns {TipoBusqueda=}
   */
  getTipoBusqueda(searchString: string): TipoBusqueda {
    let tipoBusqueda: TipoBusqueda = TipoBusqueda.SIN_DEFINIR;
    if (/^(?:0?[1-9]|[1-4]\d|5[0-2])\d{3}$/.test(searchString)) {
      tipoBusqueda = TipoBusqueda.CP;
    } else if (/^[^\d]+\s\d+,[^\d]+?$/.test(searchString)) {
      const fields = searchString.split(',')
      if (fields.length == 2 && fields[1].trim().length > 0) {
        tipoBusqueda = TipoBusqueda.CALLE;
      }
    } else if (/^[^\d]+$/.test(searchString)) {
      if (searchString.trim().length > 0) {
        tipoBusqueda = TipoBusqueda.LOCALIDAD;
      }
    }
    return tipoBusqueda;
  }

  /**
   * 
   * @ngdoc method
   * @name MapService.getBBox
   * @description
   * @param {any=} features 
   * @returns {Coordinate=}
   */
  getBBox(features: any): Coordinate[] {
    let bbox = [[Infinity, Infinity], [-Infinity, -Infinity]];
    for (let feature of features) {
      if (feature.geometry.type == 'LineString') {
        for (let coordinate of feature.geometry.coordinates) {
          bbox[0][0] = coordinate[0] < bbox[0][0] ? coordinate[0] | 0 : bbox[0][0];
          bbox[1][0] = coordinate[0] > bbox[1][0] ? coordinate[0] | 0 : bbox[1][0];
          bbox[0][1] = coordinate[1] < bbox[0][1] ? coordinate[1] | 0 : bbox[0][1];
          bbox[1][1] = coordinate[1] > bbox[1][1] ? coordinate[1] | 0 : bbox[1][1];
        }
    }
    }
    return bbox;
  }

  /**
   * 
   * @param feature 
   */
  onFeatureSelectFuncion(evt: any, feature: any) {
    let info = {
        via_loc: feature.get('via_loc'),
        anyo: 0,
        vivienda_min: 0,
        vivienda_max: 0,
        vivienda_media: 0,
        local_min: 0,
        local_max: 0,
        local_media: 0
    };
    for (let valor of JSON.parse(feature.get('valores'))) {
        if (valor.anyo >= info.anyo && valor.tipo === 1) {
            info.anyo = valor.anyo;
            info.vivienda_min = valor.min;
            info.vivienda_max = valor.max;
            info.vivienda_media = valor.media;
        } else if (valor.anyo >= info.anyo && valor.tipo === 2) {
            info.anyo = valor.anyo;
            info.local_min = valor.min;
            info.local_max = valor.max;
            info.local_media = valor.media;
        }
    }
    console.log(info);
  }

}
