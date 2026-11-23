import type { ComponentType } from "react";
import type { CatalogComponent } from "@shared/a2ui";
import type { BrickName } from "@shared/catalog";
import { Button } from "./Button";
import { Card } from "./Card";
import { CheckBox } from "./CheckBox";
import { ChoicePicker } from "./ChoicePicker";
import { Column } from "./Column";
import { DateTimeInput } from "./DateTimeInput";
import { Divider } from "./Divider";
import { List } from "./List";
import { OptionCard } from "./OptionCard";
import { Row } from "./Row";
import { SeatMap } from "./SeatMap";
import type { BrickProps } from "./shared";
import { Slider } from "./Slider";
import { Stat } from "./Stat";
import { Stepper } from "./Stepper";
import { Tabs } from "./Tabs";
import { Text } from "./Text";
import { TextField } from "./TextField";

type BrickFor<K extends BrickName> = ComponentType<BrickProps<Extract<CatalogComponent, { component: K }>>>;

/** One renderer per catalog name; the mapped type makes a missing brick a type error. */
export const BRICK_COMPONENTS: { [K in BrickName]: BrickFor<K> } = {
  Text,
  Card,
  Row,
  Column,
  List,
  Divider,
  Tabs,
  Button,
  TextField,
  ChoicePicker,
  Slider,
  CheckBox,
  DateTimeInput,
  Stepper,
  OptionCard,
  SeatMap,
  Stat,
};

export function brickComponent(def: CatalogComponent): ComponentType<BrickProps<CatalogComponent>> {
  // TS cannot correlate def.component with the matching entry of the union; the map guarantees it.
  return BRICK_COMPONENTS[def.component] as unknown as ComponentType<BrickProps<CatalogComponent>>;
}
