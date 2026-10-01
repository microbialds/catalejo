// Species marks (requirements §5.4, §7; design tokens marks.species_outlines).
// A species name is italic in the serif face; in charts and tables it is set
// with the genus abbreviated, as on the collection board, and the full name
// is its title. The swatch is an 8 px square in the species color, with the
// thin ink outline the tokens require for the yellow on light backgrounds.
import { markStyle } from '../collection/species';
import { shortSpeciesName } from '../set/fields';

export function SpeciesName({
  name,
  short = false,
  className,
}: {
  name: string;
  short?: boolean;
  className?: string;
}) {
  return (
    <span className={`font-serif italic ${className ?? ''}`} {...(short ? { title: name } : {})}>
      {short ? shortSpeciesName(name) : name}
    </span>
  );
}

export function Swatch({ color }: { color: string }) {
  return <span aria-hidden="true" className="size-2 shrink-0" style={markStyle(color)} />;
}
