import { expect, it, vi } from 'vitest';
import { env, type PreTrainedTokenizer } from '@huggingface/transformers';
import { mock } from 'vitest-mock-extended';
import type { KokoroTTS } from 'kokoro-js';
import { phonemize } from '../vendor/kokoro_phonemize.mjs';
import { loadSpeechEngine } from '../src/speech_engine';

const fake = vi.hoisted(() => ({
  Tensor: class {
    dims = [1, 3];
  },
  load: vi.fn(),
  styleModel: vi.fn(),
  tokenizer: vi.fn(),
  constructed: vi.fn<(model: unknown, tokenizer: unknown) => unknown>(),
  tokenize: vi.fn(),
  generate: vi.fn(),
}));
vi.mock('@huggingface/transformers', () => ({
  env: { allowRemoteModels: true, allowLocalModels: false },
  Tensor: fake.Tensor,
  StyleTextToSpeech2Model: { from_pretrained: fake.styleModel },
  AutoTokenizer: { from_pretrained: fake.tokenizer },
}));
vi.mock('kokoro-js', () => ({
  KokoroTTS: Object.assign(
    // A constructor mock must be constructable.
    // oxlint-disable-next-line eslint/prefer-arrow-callback
    function KokoroTTS(model: unknown, tokenizer: unknown) {
      return fake.constructed(model, tokenizer);
    },
    { from_pretrained: fake.load },
  ),
}));
vi.mock('../vendor/kokoro_phonemize.mjs', () => ({ phonemize: vi.fn() }));

it('loads local CPU assets and forwards the same untruncated tokens to the model', async () => {
  const idsFromTokenizer = new fake.Tensor();
  fake.tokenize.mockReturnValue({ input_ids: idsFromTokenizer });
  fake.generate.mockResolvedValue({ audio: new Float32Array([0.5]), sampling_rate: 24_000 });
  const model: KokoroTTS = mock<KokoroTTS>();
  model.tokenizer = Object.assign(fake.tokenize, mock<PreTrainedTokenizer>(), {
    model: { tokens_to_ids: new Map(Array.from('phonemes').map((letter) => [letter, 1])) },
  });
  model.generate_from_ids = fake.generate;
  fake.load.mockResolvedValue(model);
  vi.mocked(phonemize).mockResolvedValue('phonemes');
  const engine = await loadSpeechEngine('/local/model');
  expect(env.allowRemoteModels).toBe(false);
  expect(env.allowLocalModels).toBe(true);
  expect(fake.load).toHaveBeenCalledWith('/local/model', { dtype: 'q8', device: 'cpu' });
  expect(await engine.phonemize('Hello.', 'a')).toBe('phonemes');
  const ids = engine.tokenize('phonemes');
  expect(fake.tokenize).toHaveBeenCalledWith('phonemes', { truncation: false });
  expect(() => engine.tokenize('phonemes\u2603')).toThrow('unsupported');
  expect(() => engine.tokenize('$')).toThrow('unsupported');
  expect(fake.tokenize).toHaveBeenCalledTimes(1);
  expect(await engine.generate(ids, 'af_heart', 1)).toEqual({ samples: new Float32Array([0.5]), rate: 24_000 });
  expect(fake.generate).toHaveBeenCalledWith(idsFromTokenizer, { voice: 'af_heart', speed: 1 });
  fake.tokenize.mockReturnValueOnce({ input_ids: 'invalid' });
  expect(() => engine.tokenize('phonemes')).toThrow('invalid data');
});

it('CoreMlCompute Load: loads the q8 model on the CoreML execution provider, never the CPU path (#42)', async () => {
  const model = mock<KokoroTTS>();
  const style = { model: 'style' };
  const tokenizer = { tokenizer: 'tokenizer' };
  fake.styleModel.mockResolvedValue(style);
  fake.tokenizer.mockResolvedValue(tokenizer);
  fake.constructed.mockReturnValue(model);
  fake.load.mockClear();
  await loadSpeechEngine('/local/model', true);
  expect(fake.styleModel).toHaveBeenCalledWith('/local/model', {
    dtype: 'q8',
    device: 'cpu',
    session_options: { executionProviders: ['coreml'] },
  });
  expect(fake.tokenizer).toHaveBeenCalledWith('/local/model');
  expect(fake.constructed).toHaveBeenCalledWith(style, tokenizer);
  expect(fake.load).not.toHaveBeenCalled();
  fake.styleModel.mockRejectedValueOnce(new Error('CoreML could not create the session'));
  await expect(loadSpeechEngine('/local/model', true)).rejects.toThrow('CoreML');
});
