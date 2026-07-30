using Awake.Application.Common.Models;
using MediatR;

namespace Awake.Application.Features.Maps.Commands.SaveMapLayout;

/// <summary>
/// Сохраняет расстановку под именем. Имя внутри локации уникально: повторное
/// сохранение с тем же именем перезаписывает существующую, а не плодит копии.
/// </summary>
public record SaveMapLayoutCommand(string Location, string Name, string Props)
    : IRequest<Result<MapLayoutDto>>;
