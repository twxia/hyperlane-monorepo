import { CommandModule } from 'yargs';

import { CoreConfigSchema, EvmCoreReader, IsmConfig } from '@hyperlane-xyz/sdk';

import { createHookConfig } from '../config/hooks.js';
import { createIsmConfig, createTrustedRelayerConfig } from '../config/ism.js';
import {
  CommandModuleWithContext,
  CommandModuleWithWriteContext,
} from '../context/types.js';
import { runCoreDeploy } from '../deploy/core.js';
import { evaluateIfDryRunFailure } from '../deploy/dry-run.js';
import {
  log,
  logBlue,
  logBoldUnderlinedRed,
  logGray,
  logRed,
} from '../logger.js';
import { detectAndConfirmOrPrompt } from '../utils/chains.js';
import { readYamlOrJson, writeYamlOrJson } from '../utils/files.js';

import {
  chainCommandOption,
  dryRunCommandOption,
  fromAddressCommandOption,
  outputFileCommandOption,
} from './options.js';

/**
 * Parent command
 */
export const coreCommand: CommandModule = {
  command: 'core',
  describe: 'Manage core Hyperlane contracts & configs',
  builder: (yargs) =>
    yargs
      .command(configure)
      .command(deploy)
      .command(read)
      .version(false)
      .demandCommand(),
  handler: () => log('Command required'),
};

/**
 * Generates a command module for deploying Hyperlane contracts, given a command
 *
 * @param commandName - the deploy command key used to look up the deployFunction
 * @returns A command module used to deploy Hyperlane contracts.
 */
export const deploy: CommandModuleWithWriteContext<{
  chain: string;
  config: string;
  dryRun: string;
  fromAddress: string;
}> = {
  command: 'deploy',
  describe: 'Deploy Hyperlane contracts',
  builder: {
    chain: chainCommandOption,
    config: outputFileCommandOption(
      './configs/core-config.yaml',
      false,
      'The path to a JSON or YAML file with a core deployment config.',
    ),
    'dry-run': dryRunCommandOption,
    'from-address': fromAddressCommandOption,
  },
  handler: async ({ context, chain, config: configFilePath, dryRun }) => {
    logGray(`Hyperlane permissionless deployment${dryRun ? ' dry-run' : ''}`);
    logGray(`------------------------------------------------`);

    try {
      await runCoreDeploy({
        context,
        chain,
        config: readYamlOrJson(configFilePath),
      });
    } catch (error: any) {
      evaluateIfDryRunFailure(error, dryRun);
      throw error;
    }
    process.exit(0);
  },
};

export const configure: CommandModuleWithContext<{
  ismAdvanced: boolean;
  config: string;
}> = {
  command: 'configure',
  describe: 'Create a core configuration, including ISMs and hooks.',
  builder: {
    ismAdvanced: {
      type: 'boolean',
      describe: 'Create an advanced ISM & hook configuration',
      default: false,
    },
    config: outputFileCommandOption(
      './configs/core-config.yaml',
      false,
      'The path to output a Core Config JSON or YAML file.',
    ),
  },
  handler: async ({ context, ismAdvanced, config: configFilePath }) => {
    logGray('Hyperlane Core Configure');
    logGray('------------------------');

    const owner = await detectAndConfirmOrPrompt(
      async () => context.signer?.getAddress(),
      'Enter the desired',
      'owner address',
      'signer',
    );

    // Create default Ism config (advanced or trusted)
    let defaultIsm: IsmConfig;
    if (ismAdvanced) {
      logBlue('Creating a new advanced ISM config');
      logBoldUnderlinedRed('WARNING: USE AT YOUR RISK.');
      logRed(
        'Advanced ISM configs require knowledge of different ISM types and how they work together topologically. If possible, use the basic ISM configs are recommended.',
      );
      defaultIsm = await createIsmConfig(context);
    } else {
      defaultIsm = await createTrustedRelayerConfig(context);
    }

    // Create default and required Hook config
    const defaultHook = await createHookConfig(
      context,
      'Select default hook type',
    );
    const requiredHook = await createHookConfig(
      context,
      'Select required hook type',
    );

    // Validate
    const coreConfig = {
      owner,
      defaultIsm,
      defaultHook,
      requiredHook,
    };
    CoreConfigSchema.parse(coreConfig);

    writeYamlOrJson(configFilePath, coreConfig);

    process.exit(0);
  },
};

export const read: CommandModuleWithContext<{
  chain: string;
  mailbox: string;
  config: string;
}> = {
  command: 'read',
  describe: 'Reads onchain ISM & Hook configurations for given addresses',
  builder: {
    chain: {
      ...chainCommandOption,
      demandOption: true,
    },
    mailbox: {
      type: 'string',
      description: 'Mailbox address used to derive the core config',
      demandOption: true,
    },
    config: outputFileCommandOption(
      './configs/core-config.yaml',
      false,
      'The path to output a Core Config JSON or YAML file.',
    ),
  },
  handler: async ({ context, chain, mailbox, config: configFilePath }) => {
    logGray('Hyperlane Core Read');
    logGray('-------------------');

    const evmCoreReader = new EvmCoreReader(context.multiProvider, chain);
    const coreConfig = await evmCoreReader.deriveCoreConfig(mailbox);

    writeYamlOrJson(configFilePath, coreConfig);

    process.exit(0);
  },
};
