# FILE_INVENTORY — Vietnamese translation/dubbing session review

Snapshot UTC: 2026-09-16T03:00:22.786Z. Base HEAD: `d73db0378aabbca81969e0098cebac7ed70d2dfc`. This is a dirty working-tree review, not a commit diff audit.

Inventory covers the session translation/dubbing feature and its consumers. It does not claim a whole-repository audit. Review modes distinguish full reading, selected call paths, and test execution. SHA-256 pins the actual working files inspected; file presence is not proof of implementation completeness.

## Core implementation: full module review

| Path | Lines | SHA-256 |
| --- | ---: | --- |
| `src/main/translation/capabilitySnapshot.ts` | 42 | `2fc9edd42e5606c900d5bccccd28cddd50d7825075db74f8d54b14758cb64a8d` |
| `src/main/translation/requestBudget.ts` | 71 | `b8bdcc1a5f0a97c7f7e8e3288ab3a9f648bdb5954404d904dcbe906e75310caa` |
| `src/main/translation/speechBudget.ts` | 38 | `d3bc7ffec1fe911b999ce67fec037089a1cf013abd832d349222f92296169716` |
| `src/main/translation/speechUnitPlanner.ts` | 89 | `aedb6982fc878801c814cdc36328ff36a890d9471cd0b642ced442f5ab1a164b` |
| `src/main/translation/viStyleProfile.ts` | 39 | `f1283af9f58e3fef96fe534a5668650cb11e546c2e75691ca090922d4ef80442` |
| `src/main/translation/semanticEvidence.ts` | 34 | `b7594103e0b7f2a64be0b0548ee93042ab99ae639f35b82fae5fcf9162bb75f0` |
| `src/main/translation/qualityDecision.ts` | 11 | `2d80e51a008d3fc72badddf35404e42682e52a0534dd098d5f39ec1e3497f37b` |
| `src/main/translation/planner.ts` | 342 | `07c9228d411198bbcea58124ed3cb5a9cb1da7f4f78debf79a3b4ab9029219d9` |
| `src/main/translation/orchestrator.ts` | 556 | `9109f422323f7937fea54354be09a3b5f11b69b91a6be9dbe0f1bf890bc805a3` |
| `src/main/translation/checkpoint.ts` | 333 | `845230692717e61f1141dedc08418c8a175d69ff2302a7daa3f711d944687311` |
| `src/main/dubbing/feedbackDecision.ts` | 20 | `52ebe5ac44a4aa306afdda0849cfd23348ab167536acc37722f66aa8d7b0f46d` |
| `src/main/dubbing/synthesis.ts` | 1135 | `a50574dcd9167c5f5d186443e6b00297e06dfc5745a8a25809f828ad6a8abbcc` |
| `src/main/geminiGateway.ts` | 926 | `905cccadc249aa3caef8bfa58d40f459fd3f04209fbbcd75765a5adae04d1c73` |
| `src/main/geminiGatewayPrompts.ts` | 177 | `9024a431d6462db2e4df2ed39a9a665fe9c6355cfc5e0c2bebeb76fb3948ccaa` |
| `src/main/geminiGatewayDraftCheckpoint.ts` | 222 | `a73ad61706fa5fec4619b968522c98df8963991727f79b964654927b6b648661` |
| `src/shared/speechUnitPlan.ts` | 42 | `782923ab7082e3c1953ee49045488e5a00c9d598271756c904f82e62c03c23b2` |
| `scripts/evaluate-vietnamese-dubbing.mjs` | 192 | `d94a235d6c3181267ca7aea00a5844e3ac4450d5d469952966684c19145d21af` |

## Integration and supporting contracts: focused sections and call-site search

| Path | Lines | SHA-256 |
| --- | ---: | --- |
| `src/main/autoshort.ts` | 3829 | `d9cc0f8d1ecf3f08cd38cb78150895944718823ac9d6d46597326c0a8259c183` |
| `src/main/autoShortItemCoordinator.ts` | 2000 | `bedcc426169d3fc7b02ed8f9fcb118775fdef20d4a3b05e186a28f079c35914e` |
| `src/main/autoShortContentQuality.ts` | 343 | `555e60ab1510632eab4a41100b29f06a74522ff9d2ba3078cd3f6f0f26030ab1` |
| `src/main/dubbing/plan.ts` | 311 | `d8354b90889eae7b434c1d6b3f9e2321eb960f393092993ca775bf108dc3e5b4` |
| `src/main/dubbing/translation.ts` | 147 | `a9f37684f2b19370c5981aebe0ba4b4ac289bb5d73b87ae57f285c9313d939a7` |
| `src/main/dubbing/timeMap.ts` | 108 | `890409bc3b435bf70b0f87a79021eda5c996837301fcf884fcb101f1b9f667b7` |
| `src/main/translation/fileRunner.ts` | 178 | `1ee99b8bef7943876821f0420b0362a76e552d5aa9f69bc1000df072b2e9615a` |
| `src/main/translation/budget.ts` | 269 | `c686dd748a1b219e5a35fa1c35a2fdece16e3db46697ce11d11d673af5aee927` |
| `src/main/translation/response.ts` | 320 | `61e125873e51ce4696a2c13265e0d2d52f94e0013be60378972f1220ff5d3fb5` |
| `src/main/sourceSpeechGrouping.ts` | 56 | `b7a6c43695d5a51e2b45497a456ba4ca61c7f24ce737cad19eef5bc387481763` |
| `src/shared/translation.ts` | 129 | `986a79b5c597e0640d50f844f2eef0f6341ec39efc5e726bd8f61d444af8f758` |
| `scripts/run-local-runtime-tests.mjs` | 177 | `e5bd9cf293c6799a9ec33c384bb8d000c7cbd4f1ab1ab2af6c4e33a5b63dcf36` |

## Regression suites: executed; relevant assertions inspected (not every test body)

| Path | Lines | SHA-256 |
| --- | ---: | --- |
| `tests/translation-capability-snapshot.test.ts` | 31 | `c6e52f63ea5a2bb76ebb6ddfd861fb8328e7debe6bf69c944c7cf5d73ec9c35d` |
| `tests/translation-request-budget.test.ts` | 34 | `8de98c8d691837aaab93750c06818868d1ddaf45602d521aa1fe5f2d568da217` |
| `tests/speech-unit-plan.test.ts` | 11 | `cb56b3a06d7239b24d19908102a15076ab9e5b0a94c2f7e65a97400b44d4ef82` |
| `tests/speech-unit-planner.test.ts` | 37 | `34a3d884ec8491e2a1ee9d42d879b4c380ae45764bb29fcb0ec6ec1ce36ec422` |
| `tests/speech-budget.test.ts` | 19 | `9b9a12bca879782c7a5c1b1e298df5ff094ed5d6214fd2ccc223496d0bfdfec4` |
| `tests/vietnamese-style-profile.test.ts` | 27 | `19bbb6629b29cbef49131b27f2d263ce18453216b870cdf203e532c01f2218b6` |
| `tests/translation-semantic-evidence.test.ts` | 78 | `96b09afb44b24ed150b9434519e9fbb89aa6ac2b293cf825b5d725b6dda91249` |
| `tests/dubbing-feedback-decision.test.ts` | 37 | `d1c4ca82d83b546c5397b7bd91d72dda5ee1ac2edeff5260681c9a7a27341fa9` |
| `tests/vietnamese-evaluation.test.ts` | 48 | `add0f4d524f25b401fc4a33a20855e42e2a2ab81affa4d4e481e4e093a685033` |
| `tests/gemini-gateway-long-context.test.ts` | 82 | `7fc7bdc24a8aa3de700138de696d161ef0bb05146ae1c2bff98541218ee2016a` |
| `tests/gemini-gateway-prompts.test.ts` | 156 | `43aa9ef9dbba9a72f206a66efeb32072746a17fd1b4883a95cef1ede029d04a8` |
| `tests/gemini-gateway-contract.test.ts` | 519 | `375ba34c205f53ef561c699045eef04d67b46eace7026ec2fa09681432913479` |
| `tests/gemini-gateway-draft-resume.test.ts` | 226 | `cb525fa98c51854bf65bf117123c14b44e74002f08fa7ba92be807956ce3ecda` |
| `tests/translation-planner.test.ts` | 231 | `2efc53c328065d7cf162c676c66c0c0303c1a3098be3b0e1ee2cc8668fd222a6` |
| `tests/translation-orchestrator.test.ts` | 517 | `d55e721ab118a0c4329ff29d0ebc021e06fc98973fdd3ea95052d936510bd295` |
| `tests/translation-rephrase.test.ts` | 419 | `3a9ad7d8172206eaff41c9fff3e897c260600faa4a72c54ffe812c356f5b3c38` |
| `tests/autoshort-content-quality.test.ts` | 240 | `e2e404c258821549d7143702dcee9b0c8b274d40619c3c9befc0ff8553f8c991` |
| `tests/dubbing-plan.test.ts` | 1277 | `99d76d7d2c6d3da9644b66917a7522d4c7f62f8f1f0bc629270fdd0e5ec0e835` |
| `tests/translation-resume.test.ts` | 112 | `c17c85304cd585882c02d0cd6cb7be301bf6e0b65988f90d8deb03b44e6b8dff` |
| `tests/translation-identity.test.ts` | 49 | `0e4fc47d539b8ee7e9c36fc9055fd5c616676ee90d68f48b7e9da3316e3c2282` |
| `tests/autoshort-tts-pipeline.test.ts` | 377 | `e13bcd63bfd245790fa64e9b3c323aa110a3094c77f8b770345e985b98697c05` |

## Guidance and design evidence: scope-relevant sections

| Path | Lines | SHA-256 |
| --- | ---: | --- |
| `AGENTS.md` | 99 | `f23c9d035e6ee8b56ec05dc54d93154b5aa1e5c074c4937ea9a0fe551cc07f99` |
| `src/main/AGENTS.md` | 41 | `05e7d744b675b7786afb87a6a6062a51bb0b4c00f4b2c665ec529189a8e96894` |
| `src/main/dubbing/AGENTS.md` | 40 | `4152e55af3f6cd404a6d9e54ee2a607ffb00e36018cf7dc03e2cb2a143461704` |
| `src/shared/AGENTS.md` | 41 | `23ee820c07bfd3bda6248a72772366146a1bdae7828356d34230822788556da3` |
| `.ai/tasks/TASK_TEMPLATE.md` | 70 | `58c1eab960ae85c9be466f642222007df057f124bc9b8203227f0b296cc795af` |
| `docs/architecture.md` | 194 | `d2e16684919c032e134c3f441d28d2689200f4a34fd732c5a90b8d454f78987f` |
| `docs/domain.md` | 124 | `2aebfc159753f30ad4108e5c904c75568318d2102be0c9cf6b60b16872915943` |
| `docs/adr/005-source-anchored-dubbing-tempo-policy.md` | 136 | `5774594725c829a793a2d771d3a0b5c7446bad351a436c35dc292983026c2545` |
| `docs/superpowers/specs/2026-09-15-vietnamese-duration-aware-translation-design.md` | 275 | `7d7c5590706a2ed7aa32cc68bab6a3023c57b689cba5155393d6709072476b9b` |
| `docs/superpowers/specs/2026-09-15-vietnamese-duration-aware-translation-contracts.md` | 549 | `4e15b8040c5bd805162d34921d3e6f0a71f2311f87048651bcc5ce6cdbc9ad25` |
| `docs/superpowers/plans/2026-09-15-vietnamese-duration-aware-translation.md` | 303 | `e38ddebb433b59d367dd8aa46e5d94711a1fe50822c9f75cc889f06abb61b2da` |
| `docs/benchmarks/2026-09-15-vietnamese-duration-aware-translation-evaluation.md` | 218 | `cf11bffa772e9951f86a22ab6685d36cffa4898b36d1a9b34f02b4146166c020` |
| `.ai/tasks/2026-09-15-vietnamese-duration-aware-translation-core/TASK.md` | 118 | `f0b5f6131575b39735beba802e7a2caa1267d1f057b83fc834ad3aeac0413ca2` |

## Explicit exclusions

Unrelated dirty font/thumbnail/OCR/renderer/Douyin/release work, runtime engines and binaries, real user media, installed Windows artifact, real Gateway/tokenizer/TTS services, external research claims, human listening and semantic ratings. No claim is made about correctness of these excluded areas.
