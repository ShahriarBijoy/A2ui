import type { ComponentType } from "react";
import type { CatalogComponent } from "@shared/a2ui";
import type { BrickName } from "@shared/catalog";
import { Accordion } from "./Accordion";
import { Alert } from "./Alert";
import { Badge } from "./Badge";
import { Button } from "./Button";
import { Card } from "./Card";
import { Chart } from "./Chart";
import { CheckBox } from "./CheckBox";
import { ChoicePicker } from "./ChoicePicker";
import { Column } from "./Column";
import { DateTimeInput } from "./DateTimeInput";
import { Divider } from "./Divider";
import { Icon } from "./Icon";
import { Image } from "./Image";
import { List } from "./List";
import { OptionCard } from "./OptionCard";
import { Progress } from "./Progress";
import { Rating } from "./Rating";
import { Row } from "./Row";
import { SeatMap } from "./SeatMap";
import type { BrickProps } from "./shared";
import { Slider } from "./Slider";
import { Stat } from "./Stat";
import { Stepper } from "./Stepper";
import { Table } from "./Table";
import { Tabs } from "./Tabs";
import { Text } from "./Text";
import { TextField } from "./TextField";
import { Timeline } from "./Timeline";

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
  Icon,
  Table,
  Chart,
  Timeline,
  Image,
  Badge,
  Alert,
  Accordion,
  Progress,
  Rating,
};

export function brickComponent(def: CatalogComponent): ComponentType<BrickProps<CatalogComponent>> {
  // TS cannot correlate def.component with the matching entry of the union; the map guarantees it.
  return BRICK_COMPONENTS[def.component] as unknown as ComponentType<BrickProps<CatalogComponent>>;
}
