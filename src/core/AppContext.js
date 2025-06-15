import { EventBus } from '../services/EventBus.js';
import { WorldManager } from './WorldManager.js';
import * as PersistenceService from '../services/PersistenceService.js';

// Import Controller CLASSES, not instances
import { BrushController } from '../ui/controllers/BrushController.js';
import { InteractionController } from '../ui/controllers/InteractionController.js';
import { LibraryController } from '../ui/controllers/LibraryController.js';
import { RulesetActionController } from '../ui/controllers/RulesetActionController.js';
import { SimulationController } from '../ui/controllers/SimulationController.js';
import { VisualizationController } from '../ui/controllers/VisualizationController.js';
import { WorldsController } from '../ui/controllers/WorldsController.js';

/**
 * @class AppContext
 * @description
 * A central service container that instantiates and holds all major
 * controllers and services for the application. This implements a form of
 * Dependency Injection, making the application more modular and testable
 * by removing singletons.
 */
export class AppContext {
    constructor(sharedSettings, libraryData) {
        // Core Services
        this.eventBus = EventBus; // EventBus remains a true singleton for global communication
        this.persistenceService = PersistenceService;
        this.worldManager = new WorldManager(sharedSettings);

        // Controllers - instantiated here
        this.brushController = new BrushController();
        this.interactionController = new InteractionController();
        this.libraryController = new LibraryController();
        this.rulesetActionController = new RulesetActionController();
        this.simulationController = new SimulationController();
        this.visualizationController = new VisualizationController();
        this.worldsController = new WorldsController();

        // Initialize controllers that need access to other parts of the context
        this.libraryController.init(libraryData);
        
        // Set controller references in WorldManager to avoid circular dependencies
        this.worldManager.setControllerReferences(this.simulationController, this.brushController);
    }
} 