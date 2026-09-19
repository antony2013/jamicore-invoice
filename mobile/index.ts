import { registerRootComponent } from "expo";
import App from "./App";

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go, a custom dev client,
// or in a bare React Native app, the environment is set up appropriately.
registerRootComponent(App);
