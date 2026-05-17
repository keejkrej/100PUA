import nonequilibriumDoc from '../data/nonequilibrium-lmu-ss2025.json';
import selfOrganizationDoc from '../data/self-organization-lmu-ws2025-2026.json';
import stanfordCs336Doc from '../data/stanford-cs336-language-modeling-spring2025.json';
import proteinDesignDoc from '../data/protein-design-rosetta-bootcamp.json';
import polymerBlendDoc from '../data/polymer-blend-regular-solution.json';
import biochemistryWetLabTutorialDoc from '../data/biochemistry-wet-lab-tutorial.json';
import cellacdcSpotmaxDoc from '../data/cellacdc-spotmax.json';
import foundationsArtificialIntelligencePapersDoc from '../data/foundations-of-artificial-intelligence-papers.json';
import threejsLibraryDoc from '../data/threejs-library.json';

export type TopicDoc = typeof nonequilibriumDoc;

export const topicBySlug: Record<string, TopicDoc> = {
  'nonequilibrium-lmu-ss2025': nonequilibriumDoc,
  'self-organization-lmu-ws2025-2026': selfOrganizationDoc,
  'stanford-cs336-language-modeling-spring2025': stanfordCs336Doc,
  'protein-design-rosetta-bootcamp': proteinDesignDoc,
  'polymer-blend-regular-solution': polymerBlendDoc,
  'biochemistry-wet-lab-tutorial': biochemistryWetLabTutorialDoc,
  'cellacdc-spotmax': cellacdcSpotmaxDoc,
  'foundations-of-artificial-intelligence-papers': foundationsArtificialIntelligencePapersDoc,
  'threejs-library': threejsLibraryDoc,
};
