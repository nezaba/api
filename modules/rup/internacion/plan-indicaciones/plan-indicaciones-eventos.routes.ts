import { MongoQuery, ResourceBase } from '@andes/core';
import { Auth } from '../../../../auth/auth.class';
import { PlanIndicacionesEventos } from './plan-indicaciones.schema';

class PlanIndicacionesEventosController extends ResourceBase {
    Model = PlanIndicacionesEventos;
    resourceName = 'plan-indicaciones-eventos';
    middlewares = [Auth.authenticate()];
    searchFileds = {
        fecha: MongoQuery.matchDate,
        internacion: MongoQuery.equalMatch.withField('idInternacion'),
        prestacion: MongoQuery.equalMatch.withField('idPrestacion'),
        estado: MongoQuery.equalMatch
    };


}

export const PlanIndicacionesEventosCtr = new PlanIndicacionesEventosController({});
export const PlanIndicacionesEventosRouter = PlanIndicacionesEventosCtr.makeRoutes();
