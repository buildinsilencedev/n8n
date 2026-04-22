import get from 'lodash/get';
import { constructExecutionMetaData } from 'n8n-core';
import type {
	IDataObject,
	IExecuteFunctions,
	IGetNodeParameterOptions,
	ILoadOptionsFunctions,
	INode,
	INodeExecutionData,
} from 'n8n-workflow';

const node: INode = {
	id: '1',
	name: 'Composio node',
	typeVersion: 1,
	type: 'n8n-nodes-base.composio',
	position: [10, 10],
	parameters: {},
};

export const createMockExecuteFunctions = (nodeParameters: IDataObject) =>
	({
		getInputData(): INodeExecutionData[] {
			return [{ json: {} }];
		},
		getNodeParameter(
			parameterName: string,
			_itemIndex: number,
			fallbackValue?: unknown,
			options?: IGetNodeParameterOptions,
		) {
			const parameter = options?.extractValue ? `${parameterName}.value` : parameterName;
			return get(nodeParameters, parameter, fallbackValue);
		},
		getNode() {
			return node;
		},
		helpers: {
			constructExecutionMetaData,
			returnJsonArray: (data: IDataObject | IDataObject[]) => {
				const arrayData = Array.isArray(data) ? data : [data];
				return arrayData.map((item) => ({ json: item })) as INodeExecutionData[];
			},
		},
		continueOnFail: () => false,
	}) as unknown as IExecuteFunctions;

export const createMockLoadOptionsFunctions = (nodeParameters: IDataObject) =>
	({
		getNodeParameter(
			parameterName: string,
			_itemIndex: number | undefined,
			fallbackValue?: unknown,
			options?: IGetNodeParameterOptions,
		) {
			const parameter = options?.extractValue ? `${parameterName}.value` : parameterName;
			return get(nodeParameters, parameter, fallbackValue);
		},
		getCurrentNodeParameter(parameterName: string) {
			return get(nodeParameters, parameterName);
		},
		getNode() {
			return node;
		},
		helpers: {
			returnJsonArray: (data: IDataObject | IDataObject[]) => {
				const arrayData = Array.isArray(data) ? data : [data];
				return arrayData.map((item) => ({ json: item })) as INodeExecutionData[];
			},
		},
	}) as unknown as ILoadOptionsFunctions;
