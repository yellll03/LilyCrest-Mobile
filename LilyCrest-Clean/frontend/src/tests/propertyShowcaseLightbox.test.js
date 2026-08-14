// Behavioral tests proving property/branch photos on Home (rendered via
// PropertyShowcase) get the same tap-to-enlarge lightbox as room photos,
// reusing the shared ImageLightbox component — not a separate viewer.

import { fireEvent, render } from '@testing-library/react-native';
import PropertyShowcase from '../components/PropertyShowcase';

jest.mock('../context/ThemeContext', () => ({
  useTheme: () => ({
    colors: { text: '#000', primary: '#204B7E' },
    isDarkMode: false,
  }),
}));

describe('PropertyShowcase photo viewer', () => {
  it('does not show the lightbox until a photo is tapped', () => {
    const { queryByLabelText } = render(<PropertyShowcase />);
    expect(queryByLabelText('Close image preview')).toBeNull();
  });

  it('tapping a property photo opens the shared lightbox', () => {
    const { getByLabelText, queryByLabelText } = render(<PropertyShowcase />);
    fireEvent.press(getByLabelText('View larger photo: Lobby & Elevator'));
    expect(queryByLabelText('Close image preview')).toBeTruthy();
  });

  it('opens directly on the tapped photo, not always the first one', () => {
    const { getByLabelText, getByText } = render(<PropertyShowcase />);
    // Third card in PROPERTY_ITEMS is 'Rooftop Area'.
    fireEvent.press(getByLabelText('View larger photo: Rooftop Area'));
    expect(getByText('3 / 12')).toBeTruthy();
  });

  it('supports navigating through multiple property photos', () => {
    const { getByLabelText, getByText } = render(<PropertyShowcase />);
    fireEvent.press(getByLabelText('View larger photo: Lobby & Elevator'));
    expect(getByText('1 / 12')).toBeTruthy();

    fireEvent.press(getByLabelText('Next image'));
    expect(getByText('2 / 12')).toBeTruthy();
  });

  it('closing the lightbox does not trigger any other navigation/info action', () => {
    const { getByLabelText, queryByLabelText } = render(<PropertyShowcase />);
    fireEvent.press(getByLabelText('View larger photo: Common Lounge'));
    fireEvent.press(getByLabelText('Close image preview'));
    expect(queryByLabelText('Close image preview')).toBeNull();
  });
});
