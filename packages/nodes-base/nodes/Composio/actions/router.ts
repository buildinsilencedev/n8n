import type { IExecuteFunctions, INodeExecutionData } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import * as authConfig from './authConfig/AuthConfig.resource';
import * as connectedAccount from './connectedAccount/ConnectedAccount.resource';
import * as tool from './tool/Tool.resource';
import type { ComposioResource } from '../node.type';

export async function router(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
	const operationResult: INodeExecutionData[] = [];
	const items = this.getInputData();
	const resource = this.getNodeParameter('resource', 0) as ComposioResource;

	for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
		try {
			let responseData: INodeExecutionData[] = [];

			switch (resource) {
				case 'authConfig': {
					const operation = this.getNodeParameter('operation', 0) as 'create' | 'getMany';
					responseData =
						operation === 'create'
							? await authConfig.create.execute.call(this, itemIndex)
							: await authConfig.getMany.execute.call(this, itemIndex);
					break;
				}
				case 'connectedAccount': {
					const operation = this.getNodeParameter('operation', 0) as
						| 'create'
						| 'getMany'
						| 'refresh';
					switch (operation) {
						case 'create':
							responseData = await connectedAccount.create.execute.call(this, itemIndex);
							break;
						case 'getMany':
							responseData = await connectedAccount.getMany.execute.call(this, itemIndex);
							break;
						case 'refresh':
							responseData = await connectedAccount.refresh.execute.call(this, itemIndex);
							break;
					}
					break;
				}
				case 'tool':
					responseData = await tool.execute.execute.call(this, itemIndex);
					break;
				default:
					throw new NodeOperationError(
						this.getNode(),
						`The resource "${resource}" is not supported`,
					);
			}

			const executionData = this.helpers.constructExecutionMetaData(responseData, {
				itemData: { item: itemIndex },
			});

			operationResult.push(...executionData);
		} catch (error) {
			if (!this.continueOnFail()) throw error;

			operationResult.push({
				json: {
					error: (error as Error).message,
				},
				pairedItem: {
					item: itemIndex,
				},
			});
		}
	}

	return [operationResult];
}
